# Investigasi Billing Kimi Lanjutan — Under-Count Style Words

Tanggal: 2026-11-17

Status: **analisis dan rancangan eksperimen saja**. Tidak ada request BankAI baru, tidak ada perubahan kode/database/konfigurasi, tidak ada migrasi, tidak ada pengaktifan billing. `BILLING_ENABLED=false`, `BILLING_UPSTREAM_PARITY_VERIFIED=false`.

Dokumen ini menganalisis mentah 8 eksperimen variasi isi (`/tmp/opencode/kimi-content-variation.json`) dan merancang eksperimen lanjutan untuk memisahkan **repetisi konten** vs **faktor tokenisasi lain** sebagai penyebab under-count `prompt_tokens` pada style words. Tidak ada formula baru yang ditetapkan.

---

## 1. Ringkasan

- **Billing berbasis panjang karakter terbantahkan** pada eksperimen sebelumnya: 3500c → base 2201 (words) vs 2860 (code); 7024c → base 3375 (words) vs 4383 (code). Karakter sama, tagihan berbeda.
- **`prompt_tokens + 1024` = base persis untuk style code** (4/4: 1836+1024=2860, 3359+1024=4383) tetapi **under-count untuk style words** (4/4: 3500c gap 140, 7024c gap 625).
- Audit mentah menunjukkan **satu-satunya perbedaan** antar pasangan identik adalah `prompt_hash` (isi, bukan panjang); `cached_tokens` 51/0 tidak mengubah `prompt_tokens` maupun base.
- **Rasio token/karakter adalah diskriminator paling kuat yang tersedia lokal**: words 0.2457–0.2963, code 0.4782–0.5246. Under-count terjadi persis ketika rasio < ~0.30.
- **Hipotesis uji**: repetisi tinggi + keragaman rendah (entropi/word-repeat-factor) → `prompt_tokens` terlaporkan di-deflate oleh kompresi, sementara tagihan memakai tokenisasi asli. **Belum terbukti.**
- **Eksperimen lanjutan (12 request, 3 style × 2 panjang × 2 ulangan)** dirancang di §5 dengan estimasi kuota §6. **Belum dijalankan — menunggu persetujuan.**

---

## 2. Audit raw payload & response 8 eksperimen

Sumber mentah: `/tmp/opencode/kimi-content-variation.json`. Tiap baris mencatat `promptHash`, `promptPrefix`, `promptSuffix`, `structure`, seluruh `usage`, `rawPromptTokensDetails`, `rawCompletionTokensDetails`, `quotaBefore/After`, delta, `idleCheck`, `poll`. Request dikirim langsung ke BankAI (bukan lewat Rexu), non-stream, `max_tokens=64`, `temperature=0`.

Temuan audit:

1. **Panjang persis**: `promptChars` 3500/7024 pada semua baris sesuai desain (diverifikasi lokal `analyze-cv.mjs`, `lengthOk=true`).
2. **Hanya isi yang berubah antar pasangan identik**: `promptHash` berbeda per request (filler di-label per-ID, jadi byte-nya beda), sementara `prompt_tokens`, `completion_tokens`, `quotaDelta` **identik** di dalam setiap pasangan 2×. Panjang prompt byte-level berbeda isi tapi metrik sama → hasil stabil.
3. **`rawPromptTokensDetails` hanya memuat `cached_tokens`**; `rawCompletionTokensDetails` hanya `reasoning_tokens`. **Tidak ada field billing/tujuan upstream lain** — tidak ada metadata biaya yang bisa direkonstruksi dari response.
4. **`cached_tokens` tidak memengaruhi tagihan pada pasangan yang teramati**: `V-3500-code-r2` punya `cached_tokens=0` (r1=51) tetapi `prompt_tokens` 1836 dan base 2860 **tetap sama**. Bukti tipis (1 pasangan) tetapi menunjukkan cache tidak menggerakkan angka billing pada sampel ini.
5. **Semua baris konsisten**: `quotaDelta == dashboardDelta`, `sum == 95.000.000`, `requestDelta == 1`, HTTP 200, idle stabil sebelum tiap request.

---

## 3. Words vs Code — karakteristik konten & tokenisasi

Metrik lokal dihitung ulang dari prompt yang diregenerasi deterministik (`/tmp/opencode/cv-analysis-metrics.json`). Ini metrik lokal, **bukan tokenizer BankAI** — tidak ada klaim kesetaraan.

| Sifat | words | code |
|---|---|---|
| token/karakter | 0.2457–0.2963 | 0.4782–0.5246 |
| `wordRepeatFactor` | 26.3–55.3 | 36.1–73.1 |
| entropi karakter (bit) | 3.525–3.568 | 4.057–4.11 |
| rasio trigram unik | 0.0201–0.0406 | 0.0209–0.0417 |
| `prompt_tokens` 3500c | 1037 | 1836 |
| `prompt_tokens` 7024c | 1726 | 3359 |
| base 3500c | 2201 | 2860 |
| base 7024c | 3375 | 4383 |
| billed/reported | 1.135–1.362 | 1.000 |

Observasi penting (fakta):
- Gap `inferred_input − prompt_tokens` = **0** untuk code di kedua panjang, dan **140 / 625** untuk words. Gap **tidak proporsional** terhadap panjang (140/3500 = 4% vs 625/7024 = 8.9%), jadi bukan faktor linear.
- Code **juga sangat repetitif** (`wordRepeatFactor` bahkan lebih tinggi dari words) tetapi **tidak under-count**. Jadi **repetisi kata saja bukan penyebab** — yang membedakan adalah **keragaman karakter/simbol dan rasio token/karakter** (code punya 45–46 karakter unik vs words 34–35; code memuat digit, tanda baca, kurung).
- Kedua style sama-sama memakai unit berulang, tetapi **kode unit** code memuat simbol beragam sehingga menghasilkan lebih banyak token per karakter.

Interpretasi (hipotesis, belum terbukti):
- Under-count words kemungkinan berasal dari **deflasi `prompt_tokens` terlaporkan** saat konten sangat kompresibel/kurang beragam, sementara tagihan memakai penghitungan token asli. Alternatif: tagihan words yang "benar" dan code yang "over" — belum bisa dipisahkan tanpa kontrol lebih.
- Karena code **tidak** under-count, mekanisme **bukan** "repetisi kata" semata; lebih condong ke **keragaman karakter/token**. Ini yang harus diuji eksperimen lanjutan.

---

## 4. Kondisi ketika `prompt_tokens + 1024` tidak merepresentasikan base

Teramati: `prompt_tokens + 1024` **tidak** = base pada 4/4 baris words (gap 140 di 3500c, 625 di 7024c). **Tetap bertahan** sebagai kecocokan persis hanya pada code (4/4).

Yang **belum** diketahui:
- Apakah gap words konstan, proporsional, atau fungsi entropi.
- Apakah style lain (natural/technical) jatuh di sisi "persis" atau "under-count".
- Apakah lantai 2048 dan offset 1024 adalah konstanta upstream atau kebetulan sampel.

**Tidak boleh disimpulkan formula** `prompt_tokens + 1024` dari kecocokan code saja — hanya 2 panjang, 1 style, satu keluarga prompt, satu model.

---

## 5. Rancangan eksperimen lanjutan (BELUM dijalankan)

Tujuan: memisahkan apakah under-count disebabkan **repetisi** atau **keragaman karakter/token**.

**Desain**: 3 style × 2 panjang (3500, 7024) × 2 ulangan = **12 request**.

| Style | Konten | `wordRepeatFactor` | entropi karakter | rasio token/karakter (ekspektasi) |
|---|---|---|---|---|
| **natural** | 16 kalimat prose Indonesia berbeda, rotasi deterministik, kosakata bervariasi | 3.25–6.53 | ~4.17 | tinggi (prose jarang berulang) |
| **repeat** | satu token pendek `"delta "` berulang | 34–73 | ~2.7 (paling rendah) | terendah (paling kompresibel) |
| **technical** | baris perintah/identifikator unik, digit, tanda baca, kurung | 4.4–8.9 | ~5.4 (tertinggi) | tinggi |

Verifikasi lokal prompt rancangan (sudah dibangun & dicek panjang persis, disimpan `/tmp/opencode/cv2-prompt-design.json`):

| ID | chars | style | words | uniqueWords | entropi char | trigram unik | longestRun |
|---|---:|---|---:|---:|---:|---:|---:|
| N-3500-r1 | 3500 | natural | 523 | 161 | 4.175 | 0.1987 | 2 |
| P-3500-r1 | 3500 | repeat | 580 | 17 | 2.757 | 0.0329 | 2 |
| T-3500-r1 | 3500 | technical | 379 | 86 | 5.409 | 0.2035 | 4 |
| N-7024-r1 | 7024 | natural | 1052 | 161 | 4.159 | 0.0991 | 2 |
| P-7024-r1 | 7024 | repeat | 1167 | 16 | 2.681 | 0.0164 | 2 |
| T-7024-r1 | 7024 | technical | 764 | 86 | 5.409 | 0.1014 | 4 |

(masing-masing ada r2; prompt identik per pasangan, panjang persis.)

**Mengapa desain ini memisahkan hipotesis:**
- **natural vs repeat** pada panjang sama: membandingkan konten **bervariasi** vs **sangat repetitif** → jika base natural ≈ `prompt_tokens+1024` tapi repeat under-count, repetisi/entropi adalah penyebab.
- **technical vs natural**: keduanya bervariasi tetapi technical kaya **simbol/digit**, natural kaya **kata**. Jika keduanya persis, keragaman karakter (bukan bahasa) adalah penentu; jika technical persis tapi natural tidak, terkait tipografi/karakter khusus.
- **repeat vs words** (eksperimen lama): kedua repetitif; memperjelas apakah tingkat repetisi atau jenis karakternya yang penting.
- **2 ulangan per sel** menguji reproduksibilitas (pasangan identik di eksperimen lama 8/8 reproducible).

**Kontrol tetap**: prompt langsung ke BankAI (bukan Rexu), non-stream, `max_tokens=64`, `temperature=0`, idle-check 2 detik **sebelum tiap request**, snapshot kuota sebelum/sesudah + polling hingga delta stabil, catat seluruh `usage` + `prompt_tokens_details` + delta. Hasil ke `/tmp/opencode/kimi-content-variation-2.json` (**file baru**; tidak menyentuh data lama).

**Gate keberhentian**: bila kuota awal < **36.000** atau idle tak stabil → hentikan tanpa menjalankan request.

**Kriteria pembacaan hasil:**
- Jika base **natural ≈ technical ≈ `prompt_tokens+1024`** dan base **repeat < itu** → repetisi/entropi rendah penyebab under-count.
- Jika **ketiga** style persis → under-count words spesifik filler lama; `prompt_tokens+1024` jadi kandidat kuat (tetap **belum** formula final).
- Jika **hanya technical** persis → keragaman karakter/simbol adalah diskriminator.
- Jika **gap menyebar kontinu** → tidak ada diskriminator biner; `prompt_tokens` under-count tak terprediksi dari metrik lokal yang diuji.

---

## 6. Estimasi kebutuhan kuota

Berdasarkan base teramati pada 3500c/7024c (2.201–4.383):

- Batas bawah (jika semua natural/technical lebih rendah, repeat di lantai 2048):
  6×2.048 + 6×2.048 ≈ **24.576**
- Realistis (repeat ~2.201–2.3xx, natural/technical antara words & code):
  6×~2.4xx + 6×~4.0xx ≈ **38.000**
- Batas atas (jika natural/technical menyentuh code 2.860/4.383):
  6×2.860 + 6×4.383 ≈ **43.458**

**Estimasi untuk persetujuan: ≈ 38.000 kuota, batas atas aman 43.458.** Kuota tersedia saat audit: ~19,94 juta — cukup jauh.

---

## 7. Prediktor deterministik yang dapat direkonstruksi Rexu

Kandidat yang **dapat dihitung dari data runtime tanpa request baru**:
- `usage.prompt_tokens` — tersedia setelah response; prediktor terbaik saat ini (persis untuk code, under-count untuk filler repetitif). Belum formula.
- `usage.total_tokens`, `completion_tokens`, `cached_tokens` — tersedia; cached belum terbukti memengaruhi billing.
- Metrik lokal prompt (panjang, jumlah karakter unik, entropi, rasio kata unik, trigram unik) — dapat dihitung deterministik dari body pelanggan **sebelum** request; kandidat diskriminator, **bukan** biaya. Eksperimen lanjutan menguji korelasinya dengan gap.

Kandidat yang **tidak** tersedia: billed input tokens upstream, tokenizer/template BankAI, bobot cache/reasoning, atribusi kuota per request (kuota level akun via `GET /v1/quota`, hanya admin).

---

## 8. Batasan & flag

- Tidak ada request BankAI baru sejak `kimi-content-variation.json`.
- Tidak ada perubahan kode/database/konfigurasi/dokumentasi proyek.
- Tidak ada migrasi; billing tetap matang: `BILLING_ENABLED=false`, `BILLING_UPSTREAM_PARITY_VERIFIED=false`.
- Eksperimen lanjutan (§5) **belum dijalankan** dan membutuhkan persetujuan eksplisit kuota.

---

## Referensi

- Data mentah 8 eksperimen: `/tmp/opencode/kimi-content-variation.json`
- Metrik lokal 8 eksperimen: `/tmp/opencode/cv-analysis-metrics.json` (`/tmp/opencode/analyze-cv.mjs`)
- Prompt rancangan lanjutan (lokal, belum dikirim): `/tmp/opencode/cv2-prompt-design.json` (`/tmp/opencode/design-cv2.mjs`)
- Audit runtime: `docs/kimi-runtime-billing-audit.md`
- Data kalibrasi lama: `tmp/bankai-multiplier-measurements.json`, `/tmp/opencode/kimi-billing-exploration.json`, `/tmp/opencode/kimi-transition-followup.json`