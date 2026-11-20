# Desain Billing Rexu (Sistem Kredit / RC)

Status: **diimplementasikan, tetapi belum diaktifkan**.
`BILLING_ENABLED=false` dan `BILLING_UPSTREAM_PARITY_VERIFIED=false` tetap dipertahankan. Tidak ada pemotongan saldo pada request nyata sampai kedua flag itu diaktifkan secara eksplisit.

Dokumen pendukung: `docs/bankai-multiplier-report.md`, `tmp/bankai-multiplier-measurements.json`, `tmp/upstream-billing-verify.json`.

## 1. Unit dan konstanta

Billing Rexu memakai satuan kredit **RC**.

```ts
const CREDIT_RATE = 1_000n; // 1 RC = 1.000 token BankAI
const BP = 10_000n;         // basis poin
```

Semua nilai saldo, reservasi, dan potongan disimpan dalam RC sebagai `bigint` integer. Token hanya dipakai sebagai satuan teknis upstream dan audit.

Naming:

- Database dan kode internal memakai `*_credits` / `credits*`.
- API dan UI yang menghadap pelanggan memakai **RC**: `totalRc`, `usedRc`, `reservedRc`, `remainingRc`, `rcLimit`, `rcUsed`, `rcDeducted`, `rc_deducted`.
- Kata "token" hanya muncul sebagai detail teknis di usage log: `rawTokens`, `promptTokens`, `completionTokens`, `cachedTokens`, serta kolom audit `tokens_billed` / `tokens_reserved` di admin.
- `bankai_multiplier_bp` tidak pernah diekspos ke endpoint user biasa.

## 2. Skema

### 2.1 `wallets`

| Kolom | Tipe | Arti |
|---|---|---|
| `total_credits` | bigint | total saldo RC |
| `used_credits` | bigint | RC terpakai |
| `reserved_credits` | bigint | RC yang sedang direservasi |

Constraint: ketiga kolom non-negatif, dan `used_credits + reserved_credits <= total_credits`.

### 2.2 `api_keys`

| Kolom | Tipe | Arti |
|---|---|---|
| `credit_limit` | bigint nullable | batas RC untuk key |
| `credits_used` | bigint | RC terpakai oleh key |

### 2.3 `usage_logs`

Kolom audit token mentah tetap ada:

- `raw_tokens`
- `cached_tokens`
- `context_tokens`
- `generation_tokens`

Kolom billing:

| Kolom | Tipe | Arti |
|---|---|---|
| `multiplier_bp` | integer | snapshot markup Rexu saat request |
| `bankai_multiplier_bp` | integer | snapshot multiplier BankAI saat request |
| `effective_min_block` | integer | snapshot minimum block yang dipakai saat request |
| `tokens_billed` | bigint | token BankAI setelah multiplier BankAI × markup Rexu |
| `tokens_reserved` | bigint | estimasi token saat reservasi (upper bound) |
| `credits_deducted` | bigint | RC yang benar-benar dipotong |
| `credits_reserved` | bigint | RC yang direservasi |

### 2.4 Migration `0004_credits`

- `wallets.total_tokens` → `total_credits`
- `wallets.used_tokens` → `used_credits`
- `wallets.reserved_tokens` → `reserved_credits`
- `api_keys.token_limit` → `credit_limit`
- `api_keys.tokens_used` → `credits_used`
- `usage_logs.deducted_tokens` → `tokens_billed`
- `usage_logs.reserved_tokens` → `tokens_reserved`
- tambah `usage_logs.credits_deducted` dan `usage_logs.credits_reserved`
- constraint wallet dan usage log disesuaikan dengan nama/kolom baru

### 2.5 Migration `0005_min_billing`

- tambah `models.min_block_override` (nullable; `NULL` = formula `2048 × bankai_multiplier`)
- tambah `usage_logs.effective_min_block` (snapshot nilai yang dipakai saat request)
- isi override `gpt-6-luna` dan `gpt-6-astra` sebesar `45.680` token

## 3. Formula potongan

`calculateDeductedCredits(rawTokens, bankaiMultiplierBp, minBlockOverride = null, rexuMarkupBp = 10_000)`:

```ts
const BP = 10_000n;
const RATE = 1_000n;
const MIN_BLOCK_BASE = 2_048n;

const tokensByFormula =
  (BigInt(rawTokens) * BigInt(bankaiMultiplierBp) * BigInt(rexuMarkupBp) + (BP * BP - 1n)) /
  (BP * BP);

const minBlock =
  minBlockOverride != null && minBlockOverride > 0
    ? BigInt(minBlockOverride)
    : (MIN_BLOCK_BASE * BigInt(bankaiMultiplierBp)) / BP;

const effectiveTokens = tokensByFormula > minBlock ? tokensByFormula : minBlock;
const creditsDeducted = (effectiveTokens + RATE - 1n) / RATE;
```

`calculateBilledTokens(...)` tetap mengembalikan `tokensByFormula` dan disimpan di `usage_logs.tokens_billed` untuk audit. `credits_deducted` memakai `max(tokensByFormula, minBlock)`, sehingga request pendek tetap ditagih minimum block BankAI. `usage_logs.effective_min_block` menyimpan nilai minimum block yang dipakai saat itu.

Contoh (markup Rexu 1×):

| raw token | BankAI multiplier | tokens_billed | min block | RC |
|---:|---:|---:|---:|---:|
| 1.000 | 1× | 1.000 | 2.048 | 3 |
| 1.000 | 2× | 2.000 | 4.096 | 5 |
| 7.000 | 1× | 7.000 | 2.048 | 7 |
| 1.001 | 1,5× | 1.502 | 3.072 | 4 |
| 4.705 | 8× (override 45.680) | 37.640 | 45.680 | 46 |

Markup Rexu diambil dari snapshot `usage_logs.multiplier_bp` saat settlement, dengan default `10_000` jika tidak tersedia. Perubahan markup hanya berlaku untuk request berikutnya.

## 4. Reservasi

`estimateReservationCredits(body, bankaiMultiplierBp, minBlockOverride = null)`:

```ts
estimatedRaw = ceil(chars * 0.6 + 512) + completionReserve + images * 4.096
total        = calculateDeductedCredits(estimatedRaw, bankaiMultiplierBp, minBlockOverride) + 1
```

`max_tokens` memakai `max_tokens` atau `max_completion_tokens`; jika kosong memakai `billing_default_reserve`. Buffer `+1 RC` menutup pembulatan. Minimum block ikut diperhitungkan agar reservasi tidak lebih kecil dari tagihan aktual.

Saat reservasi:

- `wallets.reserved_credits += reserveCredits`
- `usage_logs.credits_reserved = reserveCredits`
- `usage_logs.tokens_reserved = reserveCredits * 1.000` (upper bound audit)
- reservasi ditolak `429 insufficient_quota` jika saldo tersedia tidak cukup

## 5. Settlement dan rekonsiliasi

`settleUsage`:

1. Kunci usage log dan wallet.
2. Hitung `tokens_billed` (formula) dan `credits_deducted` dari `raw_tokens`, snapshot multiplier, dan `effective_min_block` (fallback ke `models.min_block_override` untuk baris lama).
3. `applied = min(credits_deducted, total_credits - used_credits - reserved_lain)`.
4. `wallets.used_credits += applied`, `wallets.reserved_credits -= credits_reserved`.
5. Simpan `tokens_billed`, `credits_deducted`, dan nol-kan reservasi.
6. Jika `applied < credits_deducted`, status `insufficient_quota` dan `shortfall` dicatat.

`reconcileUsage` memakai jalur yang sama untuk log berstatus `reserved`, `reconciliation`, atau `failed`, dengan catatan admin di `audit_logs`.

`releaseUsage` mengembalikan `reserved_credits` tanpa memotong `used_credits`. Reservasi kedaluwarsa dipindahkan ke status `reconciliation` oleh `reconcileExpiredReservations`.

## 6. Serialisasi ke pelanggan

- Wallet: `totalRc`, `usedRc`, `reservedRc`, `remainingRc` (string bigint).
- API key: `rcLimit`, `rcUsed`.
- Usage log user: `rawTokens`, `promptTokens`, `completionTokens`, `cachedTokens`, `rcDeducted`. `bankaiMultiplierBp` tidak dikirim.
- `/v1/usage`: `totals.rcDeducted` dan `by_model[].rc_deducted`, ditambah `raw_tokens` sebagai detail teknis.
- Header `x-quota-remaining` pada `/v1/chat/completions` berisi sisa RC.
- Admin usage log: `tokensBilled`, `tokensReserved`, `creditsDeducted`, `creditsReserved`, `effectiveMinBlock`.
- Admin model: tetap mengekspos `bankaiMultiplier`, `bankaiMultiplierBp`, `minBlockOverride`, dan `effectiveMinBlock`.

## 7. Multiplier dan model gratis

- `models.bankai_multiplier_bp`: tarif BankAI, diisi dari tabel terverifikasi di `packages/shared/src/bankai-multipliers.ts`. Sync otomatis memakai nilai itu untuk model baru; model yang belum terverifikasi memakai default 1x dan tetap nonaktif sampai diatur manual.
- `models.multiplier_bp`: markup Rexu, boleh dipublikasikan ke pelanggan.
- Keduanya disnapshot ke `usage_logs` saat request dibuat dan dipakai saat settlement.
- Model gratis BankAI (`gateway="free"` atau ID berakhiran `-FREE`) tidak disinkronkan sebagai model berbayar; jika sudah ada, dinonaktifkan dan dibuat tidak tersedia.

## 8. Prinsip upstream accounting

Pemotongan pelanggan dan biaya upstream tetap dipisahkan:

- Pelanggan ditagih per request secara deterministik dari snapshot multiplier dan formula di atas.
- Quota delta BankAI (`remainingTokens`) hanya dipakai untuk kalibrasi dan rekonsiliasi agregat per jendela waktu, bukan untuk menagih per pelanggan.
- `coverage = sum(credits_deducted) / quotaDelta_actual` dievaluasi per model/per hari setelah billing aktif. Selisih agregat menjadi biaya Rexu dan dicatat sebagai laporan, bukan koreksi retroaktif pelanggan.

## 9. Status aktivasi

Billing tetap mati. Urutan aktivasi yang aman:

1. **Dry run**: hitung dan simpan `credits_deducted` tanpa memotong wallet; bandingkan dengan quota delta.
2. **Parity**: pastikan `usage.requests`, token mentah, dan coverage konsisten pada periode uji.
3. **Aktivasi terbatas**: `BILLING_ENABLED=true` hanya untuk akun internal/uji dengan saldo kecil setelah `BILLING_UPSTREAM_PARITY_VERIFIED=true`.
4. **Aktivasi umum**: setelah reconciliation stabil dan aturan RC dipublikasikan ke pelanggan.

Selama status masih mati, usage log ditandai `skipped`. `credits_deducted` tetap diisi sebagai **shadow billing** dari `max(raw_tokens × bankai_multiplier_bp, effective_min_block)`, tetapi wallet tidak disentuh. Nilai ini dipakai untuk membandingkan perkiraan potongan RC dengan penurunan quota BankAI.
