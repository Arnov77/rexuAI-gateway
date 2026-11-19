# Audit Runtime Billing Kimi — Rexu

Tanggal audit: 2026-11-17

Status: **audit dan analisis saja**. Tidak ada request BankAI baru, tidak ada perubahan kode/database/konfigurasi, tidak ada migrasi, tidak ada pengaktifan billing, tidak ada perubahan data kalibrasi lama. `BILLING_ENABLED=false`, `BILLING_UPSTREAM_PARITY_VERIFIED=false`.

Tujuan: menentukan apakah Rexu dapat menghitung biaya upstream per request `kimi-k2.7-code` secara deterministik dari data yang tersedia saat runtime, tanpa mengandalkan perkiraan panjang karakter.

Dokumen ini memakai **14 pengukuran Kimi** yang sudah ada (multiplier 1) dan membaca implementasi aktual di `apps/api/src`. Tidak ada klaim metadata yang tidak ditemukan di kode atau data mentah.

---

## 1. Ringkasan eksekutif

1. **Kimi belum bisa ditagih dengan aman.** Kuantitas "input billing" upstream belum dapat direkonstruksi per request dari data runtime apa pun yang tersedia di Rexu. `usage.prompt_tokens` yang dilaporkan upstream **lebih kecil** dari input billing terinferensi (7024c: `prompt_tokens` 1726–1731 vs input terinferensi 2351), sehingga formula `max(2048, prompt_tokens + 1024)` yang cocok untuk claude-opus-5.5/gemini **tidak cocok** untuk kimi.
2. **Base unit BankAI untuk kimi hanya terekam sebagai selisih kuota akun** (`quotaDelta == dashboardDelta` pada 14/14 baris), yang hanya bisa diamati dengan snapshot `GET /v1/quota` sebelum/sesudah oleh skrip eksternal. Jalur runtime Rexu **tidak pernah** memanggil quota per request, sehingga nilai ini **tidak tersedia saat runtime**.
3. **Tidak ada metadata billing upstream** yang dibaca Rexu: hanya tiga varian request-id dari response header (`requestIdFrom`, `bankai.ts:57-64`), dan tipe `ProviderUsage` terbatas (`types.ts:22-30`). Tidak ada header biaya, tidak ada field billing pada `usage_logs`.
4. **Rexu tidak menambahkan system prompt dan tidak menormalisasi messages.** `prepareChat` hanya membuang field `stream` (`chat/service.ts:72-73`); tidak ditemukan kode injeksi/normalisasi di `apps/api/src`. Skema request `.loose()` (`schemas.ts:38-47`) berarti field tambahan pelanggan diteruskan apa adanya.
5. **Formula biaya yang berlaku sekarang** adalah `ceil(rawTokens × multiplierBp / 10000)` dengan `rawTokens = prompt_tokens + completion_tokens` (`calculateDeductedTokens`, `billing/service.ts:110-118`; `normalizeUsage`, `bankai.ts:99-123`; dipanggil di `settleUsage:296` dan `reconcileUsage:508`). Ini **tidak mengikuti** model base-unit BankAI.
6. **Reservasi** memakai heuristik `ceil(chars/2) + completion + 256` (`estimateReservationTokens`, `billing/service.ts:120-151`), yang jauh di bawah lantai 2048 BankAI untuk prompt pendek (89c → ±365 vs 2048 aktual). Settlement memotong penukuran ke `maxDeductible` dan mencatat `insufficient_quota` + `shortfall` (`billing/service.ts:297-301`), sehingga kelebihan biaya upstream **diserap Rexu**.
7. **Kesimpulan arah**: diperlukan **eksperimen tambahan** (variasi isi pada panjang tetap) **dan** kemungkinan perubahan arsitektur (metadata upstream atau rekonsiliasi account-level + penyimpanan chars/payload untuk audit). Langkah terkecil dan paling aman adalah eksperimen variasi isi 8 request yang dirancang di §10, tanpa mengubah apa pun di sistem.

---

## 2. Data kalibrasi: 14 pengukuran Kimi

Sumber (digabung, tanpa duplikasi — 14 ID unik):

- `tmp/bankai-multiplier-measurements.json` → M1–M6 (6 baris Kimi, 2026-11-16).
- `/tmp/opencode/kimi-billing-exploration.json` → R1-1, R1-2, R2-1, R2-2 (4 baris, 2026-11-17).
- `/tmp/opencode/kimi-transition-followup.json` → T1-3500-r1/r2, T2-4000-r1/r2 (4 baris, 2026-11-17).

`baseUnit = quotaDelta / multiplier` dan `tokenInputBilling = baseUnit − 1024` adalah **inferensi**, bukan field upstream. Semua baris: HTTP 200, multiplier 1, `quotaDelta == dashboardDelta`.

| ID | chars | `prompt_tokens` | `completion` | `total` | `cached` | `quotaDelta` | `dashboardDelta` | base unit | input terinferensi |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| M1 | 89 | 366 | 29 | 395 | 51 | 2048 | 2048 | 2048 (lantai) | 1024 |
| M2 | 7024 | 1730 | 29 | 1759 | 51 | 3375 | 3375 | 3375 | 2351 |
| M3 | 89 | 368 | 179 | 547 | 51 | 2048 | 2048 | 2048 (lantai) | 1024 |
| M4 | 89 | 367 | 29 | 396 | 51 | 2048 | 2048 | 2048 (lantai) | 1024 |
| M5 | 7024 | 1731 | 29 | 1760 | 51 | 3375 | 3375 | 3375 | 2351 |
| M6 | 89 | 369 | 179 | 548 | 51 | 2048 | 2048 | 2048 (lantai) | 1024 |
| R1-1 | 7024 | 1726 | 29 | 1755 | 51 | 3375 | 3375 | 3375 | 2351 |
| R1-2 | 7024 | 1726 | 29 | 1755 | 51 | 3375 | 3375 | 3375 | 2351 |
| R2-1 | 3000 | 940 | 29 | 969 | 51 | 2048 | 2048 | 2048 (lantai) | 1024 |
| R2-2 | 4500 | 1232 | 29 | 1261 | 51 | 2534 | 2534 | 2534 | 1510 |
| T1-3500-r1 | 3500 | 1039 | 29 | 1068 | 51 | 2201 | 2201 | 2201 | 1177 |
| T1-3500-r2 | 3500 | 1039 | 29 | 1068 | 51 | 2201 | 2201 | 2201 | 1177 |
| T2-4000-r1 | 4000 | 1136 | 29 | 1165 | 51 | 2367 | 2367 | 2367 | 1343 |
| T2-4000-r2 | 4000 | 1136 | 29 | 1165 | 51 | 2367 | 2367 | 2367 | 1343 |

Catatan konsistensi:
- 7024c direproduksi **4 baris** (M2, M5, R1-1, R1-2) dengan base identik 3375 dan input identik 2351 — bukan 6 seperti pernah ditulis di dokumen lama.
- Invarian pada 14/14 baris: `quotaDelta == dashboardDelta == baseUnit` dan `inferredInput == baseUnit − 1024`.

---

## 3. Analisis korelasi dan keterbatasannya

Pearson r terhadap base unit (14 titik):

| Variabel | r | Rentang pada sampel |
|---|---:|---|
| `chars` | 0.907423 | 89–7024 |
| `prompt_tokens` | 0.906881 | 366–1731 |
| `total_tokens` | 0.918448 | 395–1760 |
| `completion_tokens` | −0.355056 | 29–179 |
| `cached_tokens` | tak terdefinisi | konstan 51 |
| `quotaDelta` | 1.000000 | identitas (definisi) |
| `dashboardDelta` | 1.000000 | identitas |
| input terinferensi | 1.000000 | identitas (`base − 1024`) |

**Keterbatasan (mengapa ini bukan formula):**
- `n = 14` tetapi hanya **6 panjang karakter berbeda**; dua panjang (7024, 3500, 4000) terduplikasi sebagai pengulangan.
- Hubungan sebenarnya adalah **fungsi tangga**: lantai 2048 untuk 5 baris (89c×4, 3000c) lalu naik di atas ambang. Korelasi linear tinggi muncul karena campuran lantai dan slope, bukan karena linearitas.
- `chars` dan `prompt_tokens` **hampir collinear** pada sampel ini; tidak bisa dipisahkan kontribusinya.
- `cached_tokens` konstan 51 sehingga **efek cache tidak bisa diperkirakan sama sekali**.
- `completion_tokens` hanya dua nilai (29, 179) dan bervariasi hanya di dalam kelompok 89c yang semuanya berlantai — korelasi negatif adalah artefak.
- Satu model, satu akun, satu keluarga prompt filler, satu multiplier. Tidak ada variasi isi, struktur, bahasa, unicode, atau token unik.

Korelasi 0.907–0.918 **tidak boleh** dipakai sebagai formula billing.

---

## 4. Peta alur runtime Rexu

Alur `/v1/chat/completions` dan `/v1/chat/completions/stream`:

1. **Penerimaan & validasi**: `routes/v1.ts:60-83` mem-parsing body dengan `chatCompletionRequestSchema` (`:64`), di bawah preHandler `requireApiKey` (`:36`). Skema `.loose()` (`schemas.ts:47`) meneruskan field tambahan pelanggan. `checkTokenLimit` di `routes/v1.ts:26-33`.
2. **Validasi API key**: `lib/auth.ts:121-167` (`requireApiKey`) memilih `keyId, userId, name, status, rateLimitPerMin, tokenLimit, tokensUsed, lastUsedAt` (`:129-139`). **Tidak ada konten prompt dan tidak ada metadata billing upstream** di sini.
3. **Pembentukan payload upstream**: `modules/chat/service.ts:59-96` (`prepareChat`). Validasi model + multiplier (`:60-70`), lalu hanya membuang `stream` (`:72-73`); body upstream = body pelanggan dikurangi `stream` (non-stream membuang `stream` juga, `:132-136`). **Tidak ada system prompt yang ditambahkan; tidak ada normalisasi pesan.**
4. **Pengiriman ke BankAI**: `providers/bankai.ts:157-170` (`chat`, non-stream) dan `:172-201` (`streamChat`); stream menambah `stream: true` dan `stream_options.include_usage: true` bila `BANKAI_STREAM_USAGE` (`:176-182`). `authHeaders` (`:34-40`) memakai **satu `env.BANKAI_API_KEY` bersama**; `fetchBankai` (`:42-55`) menerapkan timeout via `AbortSignal.timeout` + abort dari klien. URL dasar dibangun di `config/env.ts:64-66`.
5. **Response non-streaming**: `chat/service.ts:145-195` — `bankai.chat` (`:156`), `normalizeUsage(result.body.usage)` (`:170`), `finishUsage` (`:171-178`).
6. **Response streaming**: `chat/service.ts:226-364` — `parseSseLine` (`:203-224`) mengumpulkan `delta.content` dan **`usage` terakhir menang** (`:215-218`); abort klien (`:286`, `:335` → `client_aborted`, `failureStatus: 'reconciliation'`); finalisasi `finalizeOnce` (`:329-337`); jalur error (`:351-362`).
7. **Normalisasi usage**: `bankai.ts:99-123` — `rawTokens = promptTokens + completionTokens` (`:121`); mengembalikan `null` bila `prompt`/`completion` hilang (`:113`); `cached`/`reasoning` opsional (`:106-111`).
8. **Pencatatan & billing**: `chat/service.ts:98-130` (`finishUsage`) → bila ada usage dan billing aktif: `settleUsage` (`:114-116`); tanpa billing: `markSkippedUsage` (`:117-118`); tanpa usage: `releaseUsage` (`:125-126`) atau `markTerminalUsage` (`:127-128`).
9. **Settlement**: `billing/service.ts:253-363` — `calculated = calculateDeductedTokens(rawTokens, multiplierBp)` (`:296`), `maxDeductible` (`:297`), `applied` (`:298-299`), `shortfall` (`:300`), `status` (`:301`), `deductedTokens = applied` (`:330`).

---

## 5. Audit ketersediaan data

**Tersedia sebelum request dikirim:**
- Body mentah pelanggan penuh (messages, params) di memori (`routes/v1.ts:64`, `chat/service.ts:72`).
- Baris model: id, multiplierBp, ketersediaan (`getModelForRequest`, `models/service.ts:72+`); snapshot multiplier disimpan per log (`billing/service.ts:204`).
- Baris API key: keyId, userId, tokenLimit, tokensUsed, rateLimit (`auth.ts:128-143`).
- Jumlah karakter, **hanya** di dalam heuristik reservasi (`contentStats`, `billing/service.ts:92-108`; `estimateReservationTokens` `:137-139`). Tidak dipersistenkan.
- Tidak ada system prompt Rexu; tidak ada tokenizer lokal.

**Tersedia selama streaming:**
- Bingkai SSE hanya dipindai untuk `usage` dan `delta.content` (`chat/service.ts:203-224`).
- `x-request-id` / `request-id` / `cf-ray` (`bankai.ts:57-64`).
- Tidak ada header lain yang dibaca.

**Tersedia setelah response:**
- `usage.prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens`, `reasoning_tokens` (dibatasi `ProviderUsage`, `types.ts:22-30`).
- `upstreamRequestId` (dari tiga header).
- Kuota akun, **hanya** via `GET /v1/quota` pada rute admin (`routes/admin.ts:297-300` → `bankai.getQuota`, `bankai.ts:150-155`). **Tidak dipanggil di jalur chat**, tidak per request.
- Persisten di `usage_logs`: `raw_tokens, cached_tokens, context_tokens (=prompt_tokens), generation_tokens (=completion_tokens), multiplier_bp, deducted_tokens, reserved_tokens, status, http_status, upstream_request_id, latency_ms, error_code` (`schema/billing.ts:20-51`). **Tidak ada** kolom prompt, payload, chars, quota delta, atau biaya upstream.

**Tidak tersedia:**
- `tokenInputBilling` / base unit per request.
- Delta kuota per request (hanya snapshot akun oleh skrip eksternal).
- Template / prefix / system prompt internal BankAI (jika ada) — tidak muncul di response.
- Identitas/versi tokenizer BankAI.
- Akuntansi cache-write/hit selain angka `cached_tokens`.
- Bobot billing token reasoning.
- Nilai `billingType` (kunci muncul di payload quota sesuai `tmp/bankai-verify.json`, tetapi nilai tak pernah terekam; rute hanya admin).

---

## 6. Evaluasi kandidat prediktor

**A. `usage.prompt_tokens`**
- Tersedia runtime: ya, **hanya setelah response** (`bankai.ts:103`).
- Sebelum request: tidak.
- Konsisten: ya sebagai angka terlaporkan, tetapi **terbukti ≠ input billing** untuk kimi (7024c: 1726–1731 vs 2351; rasio 0.734–0.736).
- Hubungan ke base: r = 0.906881, didominasi artefak lantai.
- Risiko undercharge: **tinggi**. `max(2048, prompt+1024)` pada 7024c → 2754–2755 vs aktual 3375 (kurang 620–621).
- Risiko overcharge: tidak teramati pada panjang ini; tak diketahui di luar sampel.
- Streaming: tersedia hanya bila provider mengirim chunk usage akhir (diaktifkan `bankai.ts:176-182`, default `BANKAI_STREAM_USAGE=true` di `env.ts:19-22`); usage hilang → rekonsiliasi.

**B. `usage.total_tokens`**
- Tersedia setelah response; mengandung completion (variabel).
- r = 0.918448 (tertinggi di antara field usage), tetapi tetap collinear dengan chars dan didominasi lantai.
- Undercharge: **tinggi** di bawah ±2–3k token (89c: 395–548 vs lantai 2048).
- Streaming: kaveat sama dengan A.

**C. Jumlah karakter prompt mentah**
- Tersedia sebelum dan sesudah (di memori), saat ini hanya dihitung untuk reservasi (`contentStats`, `billing/service.ts:92-108`), tidak dipersistenkan.
- Deterministik dan murah; menghitung panjang `JSON.stringify` konten (memasukkan escaping), bukan panjang persis yang dilihat BankAI.
- r = 0.907423 (sama dengan prompt_tokens karena collinearity).
- Under/overcharge: **belum bisa dikalibrasi**; 14 titik hanya mendukung pola piecewise (lantai hingga di antara 3000–3500c, lalu slope ±0.333/karakter dari 4 titik di atas lantai — fit, belum tervalidasi).
- Streaming: tersedia.

**D. Jumlah karakter payload final ke BankAI**
- Tersedia sebelum kirim: ya, `upstreamBody` = body dikurangi `stream` (`chat/service.ts:72-73`, `:132-136`); panjang `JSON.stringify` bisa dihitung. Saat ini **tidak** dihitung dan **tidak** dipersistenkan.
- Selisih vs C kecil (menambah kunci model/temperature/max_tokens, mengurangi `stream`); **tidak menjelaskan** celah 625 token di 7024c. Pelanggan bisa mengirim field ekstra lewat skema `.loose()` sehingga ukurannya tak terduga.
- Tidak ada bukti BankAI menagih panjang JSON mentah.

**E. Tokenisasi lokal**
- Tidak ada di repo (perlu dependensi baru).
- Dapat dihitung sebelum request, tetapi **tidak ada bukti** kesetaraan dengan tokenizer BankAI; tidak boleh dipakai sebagai input billing.
- Hanya berguna untuk menguji hipotesis (eksperimen §10): bila hitungan tokenizer lokal berkorelasi lebih baik dengan base pada panjang tetap, hipotesis "menagih token" menguat — tetap bukan bukti kesetaraan.

**F. Metadata billing upstream**
- **Tidak ditemukan.** Header yang dibaca hanya tiga varian request-id (`bankai.ts:57-64`). `ProviderUsage` terbatas (`types.ts:22-30`). `usage_logs` tidak punya field biaya upstream (`schema/billing.ts:20-51`). `GET /v1/quota` ada (`admin.ts:297-300`) tetapi level akun, bukan per request.
- Kesimpulan: kandidat F **tidak tersedia**; jika ada di upstream, Rexu tidak membaca dan tidak menyimpannya.

---

## 7. Evaluasi formula dan tabel kalibrasi

- **Formula berbasis panjang karakter**: **tidak didukung**. Hanya 6 panjang, ambang hanya terbatas ke (3000, 3500], koefisien 0.333 berasal dari 4 titik di atas lantai dengan isi hampir seragam. Efek tokenizer/normalisasi/cache belum diuji. Koefisien `0.335` / fit `~10.51 + 0.333208×chars` adalah **pola sampel**, bukan formula.
- **Formula berbasis `usage.prompt_tokens`**: **ditolak untuk kimi**. `max(2048, prompt+1024)` bekerja untuk claude-opus-5.5 dan gemini-4-argon (6/6 masing-masing) tetapi gagal untuk kimi/glm/deepseek — celah ini spesifik model, bukan prefix Rexu.
- **Formula berbasis payload final**: **tidak ada dasar**; selisih ukuran payload terlalu kecil untuk menjelaskan gap.
- **Tabel kalibrasi berbasis rentang input**: deskriptif saja, bukan kelas billing. Tabel berbasis chars membutuhkan jauh lebih banyak panjang dan variasi isi, dan tetap berupa heuristik dengan batas galat tak diketahui.

**Kemungkinan BankAI menghitung input dengan tokenizer/normalisasi internal yang berbeda dari `usage`:**
- *Fakta*: `prompt_tokens` terlaporkan < input billing terinferensi pada kimi/glm/deepseek, dan sama persis dengan `prompt_tokens` gemini pada 7024c.
- *Hipotesis* (belum terbukti): (i) template/prefix internal upstream; (ii) tokenisasi berbeda; (iii) penjumlahan cache; (iv) serialisasi pesan berbeda; (v) bobot per token. Keempat–lima ini **hipotesis**, bukan fakta.

---

## 8. Evaluasi desain settlement

- **Reservasi sebelum request**: ada, heuristik `completion + ceil(chars/2) + images×4096 + 256` (`billing/service.ts:120-151`, `contentStats` `:92-108`). Batas `env.BILLING_MAX_RESERVE` dicek di `:141-148`; seed memakai `billingMaxReserve` 32768 dan `billingDefaultReserve` 8192 (`packages/db/src/seed.ts:20-21`). Untuk prompt 89c + `max_tokens` 64 → 64 + 45 + 256 = **365** vs 2048 aktual upstream (±5.6× kurang cadangan).
- **Settlement berdasarkan usage aktual**: memakai `rawTokens × multiplier` (`billing/service.ts:296`), **bukan** base unit BankAI. Memotong ke `maxDeductible` dan mencatat `insufficient_quota` + `shortfall` (`:297-301`), sehingga kelebihan biaya **diserap Rexu**; log ditandai `insufficient_quota` meski request sukses.
- **Streaming terputus**: abort klien memanggil `controller.abort()` (`chat/service.ts:286`); finalisasi `client_aborted`/`reconciliation` (`:329-337`). Bila usage sudah terkumpul sebelum abort, di-settle; jika tidak, `finishUsage` melepaskan reservasi (`:123-129`). **Upstream bisa saja sudah menagih** walau Rexu tak menerima usage.
- **Timeout/error upstream**: timeout via `AbortSignal.timeout` (`bankai.ts:48-49`); error → `finishUsage` tanpa usage → `releaseUsage` (`billing/service.ts:365-426`) atau `markTerminalUsage` (`:452-470`). Permintaan yang sempat sampai ke provider tetap mungkin ditagih upstream.
- **Response tanpa usage**: `normalizeUsage` → `null` bila prompt/completion hilang (`bankai.ts:113`); `finishUsage` melepas reservasi + tandai rekonsiliasi (`chat/service.ts:123-129`). Tidak ada retry otomatis; `reconcileUsage` (`billing/service.ts:472-572`) manual oleh admin.
- **Actual > reservation**: ditangani dengan potongan `maxDeductible` (`:297-299`); kekurangan tercatat, **tidak ditagih penuh** — under-billing struktural.
- **Banyak request bersamaan pada satu shared BankAI key**: reservasi wallet per user dan transaksional (`reserveUsage` `:192-244`, kunci baris wallet); log unik per `userId+idempotencyKey` dan `apiKeyId+upstreamRequestId` (`schema/billing.ts:53-58`). Namun kuota upstream adalah **level akun**; Rexu **tidak dapat mengatribusi** konsumsi kuota aktual per request, sehingga settlement internal yang sempurna pun tak bisa direkonsiliasi ke upstream tanpa snapshot eksternal. `GET /v1/quota` hanya untuk admin dan bukan per request.

**Rekomendasi arah (bukan implementasi)**: settlement perlu salah satu dari (a) metadata billed-token upstream per request, (b) replikasi lokal terverifikasi dari tokenizer+template BankAI, atau (c) rekonsiliasi berbasis snapshot kuota akun dengan single-flight — hanya layak pada konkurensi rendah. Selain itu, penyimpanan `chars`/hash payload per log (perubahan skema) dibutuhkan untuk audit pasca-terjadi.

---

## 9. Risiko billing

- **Under-billing / kehilangan pendapatan**: `prompt_tokens` atau `chars` under-prediksi untuk kimi; potongan `maxDeductible` mengubah selisih menjadi `shortfall` yang diserap Rexu.
- **Over-billing / merugikan pelanggan**: memakai `total_tokens` atau slope chars di luar panjang terkalibrasi bisa melebihi tagihan; lantai 2048 pada 89c berarti menagih 2048 meski usage total ±395 (±5× usage).
- **Celah rekonsiliasi**: abort streaming, timeout, usage hilang, dan trafik bersamaan pada key bersama.
- **Kekurangan data**: tanpa prompt/payload/biaya upstream tersimpan, audit pasca-terjadi tak dapat merekonstruksi penagihan.
- **Spesifik model**: formula yang tervalidasi untuk claude-opus-5.5/gemini **tidak** berpindah ke kimi/glm/deepseek.
- **Drift senyap**: `cached_tokens` konstan 51 pada 14 baris mengindikasikan caching atau prefix tetap; bila perilaku cache berubah, billing bisa berubah tanpa sinyal lokal apa pun.

---

## 10. Rekomendasi langkah berikutnya

**Langkah terkecil dan paling aman — eksperimen variasi isi (BELUM dijalankan; butuh persetujuan eksplisit kuota):**

- Model `kimi-k2.7-code`, multiplier 1, `BILLING_ENABLED=false`.
- Panjang tetap: **3500** dan **7024** karakter (dua panjang di atas lantai yang sudah punya baseline).
- 2 varian isi per panjang: (a) filler kata ulang Indonesia seperti run sebelumnya; (b) struktur berbeda pada panjang sama persis (contoh: token code-like, karakter tunggal berulang, dominasi spasi, unicode). Setiap varian dibangun tepat N karakter.
- 2 pengulangan per varian → 4 request per panjang, **8 request total**.
- Kontrol per request: cek idle (dua baca quota, jarak ±1.5 s, wajib sama), snapshot sebelum, request non-stream `max_tokens=64`, snapshot sesudah + polling sampai delta stabil; catat `quotaDelta`, `dashboardDelta`, semua field `usage`, hash prompt, deskriptor struktur.
- Estimasi kuota: **≤ 8.804 (batas bawah, bila lantai bertahan) … ≤ 22.304 (batas atas, 4×2201 + 4×3375)**.
- Output: `/tmp/opencode/kimi-content-variation.json` (**file baru**; tidak menyentuh data kalibrasi lama).
- Kriteria keberhasilan: bila base unit **berbeda antar varian pada panjang sama** → billing berbasis karakter **terbantahkan**, hipotesis tokenizer/normalisasi menguat. Bila **identik** → billing berbasis karakter tetap masuk akal namun belum terbukti (perlu lebih banyak panjang).
- **Jangan dijalankan tanpa persetujuan.**

**Setelah eksperimen**: baru putuskan apakah perlu perubahan skema/arsitektur (menyimpan chars/payload, membaca header billing jika ada, rekonsiliasi account-level). Sampai saat itu, tetapkan `BILLING_ENABLED=false` dan `BILLING_UPSTREAM_PARITY_VERIFIED=false`.

---

## 11. Kesimpulan wajib

1. **Apakah Kimi sudah bisa ditagih dengan aman?** Tidak. Kuantitas input billing upstream belum dapat direkonstruksi per request dari data runtime.
2. **Variabel terbaik untuk menghitung biaya per request?** Yang paling dekat: `usage.prompt_tokens` (secara konsep paling relevan tetapi under-count ±18.5% pada 7024c) dan `usage.total_tokens` (korelasi tertinggi 0.918, tetapi ter-floor dan mengandung completion). Keduanya **belum layak** untuk billing.
3. **Apakah Rexu memiliki semua informasi yang dibutuhkan?** Tidak.
4. **Informasi apa yang hilang?** Billed input tokens (atau formula/tokenizer upstream), template/prefix internal BankAI, bobot cache/reasoning, dan atribusi kuota per request pada shared key.
5. **Eksperimen tambahan, perubahan arsitektur, atau keduanya?** **Keduanya.** Eksperimen variasi isi untuk memisahkan chars vs tokenizer; arsitektur kemungkinan butuh metadata upstream atau rekonsiliasi account-level plus penyimpanan chars/payload untuk audit.
6. **Langkah paling kecil dan paling aman?** Jalankan eksperimen variasi isi 8 request (§10) tanpa mengubah kode/DB/config; flag tetap `BILLING_ENABLED=false` dan `BILLING_UPSTREAM_PARITY_VERIFIED=false`.

---

## Referensi kode (bukti sitasi)

- `apps/api/src/routes/v1.ts` — `apiKeyContext` :15-18, `checkTokenLimit` :26-33, preHandler :36, `/v1/chat/completions` :60-83, parsing :64.
- `apps/api/src/lib/auth.ts` — `requireApiKey` :121-167 (kolom terpilih :129-139; tanpa metadata billing).
- `apps/api/src/modules/chat/service.ts` — `prepareChat` :59-96 (buang `stream` :72-73), `finishUsage` :98-130, `upstreamBodyForNonStream` :132-136, `chatNonStream` :145-195 (normalizeUsage :170), `parseSseLine` :203-224 (usage terakhir menang :215-218), `chatStream` :226-364 (abort :286, finalisasi :329-337).
- `apps/api/src/providers/bankai.ts` — `authHeaders` :34-40, `fetchBankai` :42-55, `requestIdFrom` :57-64, `normalizeUsage` :99-123 (`rawTokens` :121), `chat` :157-170, `streamChat` :172-201 (`include_usage` :176-182).
- `apps/api/src/modules/billing/service.ts` — `contentStats` :92-108, `calculateDeductedTokens` :110-118, `estimateReservationTokens` :120-151, `createUsageRecord` :153-177, `reserveUsage` :179-251, `settleUsage` :253-363 (potongan :296-301), `releaseUsage` :365-426, `markSkippedUsage` :428-450, `markTerminalUsage` :452-470, `reconcileUsage` :472-572, `reconcileExpiredReservations` :574-587.
- `apps/api/src/config/env.ts` — `BANKAI_API_KEY` :13, `BANKAI_STREAM_USAGE` :19-22, URL :64-66.
- `apps/api/src/routes/admin.ts` — `GET /quota` :297-300.
- `packages/db/src/schema/billing.ts` — kolom `usage_logs` :20-65; indeks unik :53-58.
- `packages/shared/src/types.ts` — `ProviderUsage` :22-30.
- `packages/shared/src/schemas.ts` — `chatCompletionRequestSchema` :38-47 (`.loose()`).
- Data: `tmp/bankai-multiplier-measurements.json`, `/tmp/opencode/kimi-billing-exploration.json`, `/tmp/opencode/kimi-transition-followup.json`, `tmp/bankai-verify.json`.