# Rencana Kalibrasi Billing Rexu

Tanggal: 2026-11-17

Status: **analisis data lanjutan, bukan implementasi**. Tidak ada request BankAI baru, tidak ada perubahan kode atau database, `BILLING_ENABLED=false`, `BILLING_UPSTREAM_PARITY_VERIFIED=false`. Semua angka di dokumen ini berasal dari data yang sudah ada:

- `tmp/bankai-multiplier-measurements.json` (30 request terkontrol, 5 model, 3 varian, 2 pengulangan)
- `tmp/upstream-billing-verify.json` (2 request deepseek tambahan: small, medium)
- `tmp/bankai-base-unit-probes.json` (probe gagal, `quotaDelta=0`, tidak dipakai sebagai bukti)
- `tmp/bankai-verify.json` (verifikasi endpoint awal)

Dokumen pendukung: `docs/bankai-multiplier-report.md`, `docs/billing-design.md`.

---

## 0. Ringkasan eksekutif

Analisis ulang menemukan penjelasan yang lebih baik untuk kegagalan formula kandidat daripada laporan sebelumnya. Formula `max(2048, prompt_tokens + 1024)` **bukan** rumus yang salah; yang salah adalah **inputnya**.

`prompt_tokens` yang dilaporkan upstream untuk kimi-k2.7-code, glm-5.3, dan deepseek-v4.1-flash **lebih kecil dari token input yang benar-benar ditagih**. Untuk gemini-4-argon dan gpt-6-luna, angka yang dilaporkan sudah sama dengan yang ditagih.

Jika input benar disubstitusikan, satu formula yang sama cocok untuk **seluruh 30 request terkontrol**:

```
baseUnit     = max(2048, tokenInputBilling + 1024)
quotaDelta   = ceil(baseUnit * multiplierKatalog)
```

Namun `tokenInputBilling` belum bisa dihitung dari `prompt_tokens` yang dilaporkan untuk tiga model tersebut. Karena itu formula tetap **belum boleh dipakai untuk billing**. Yang berubah dari laporan sebelumnya: hipotesis sekarang jauh lebih terarah, kegagalan long_prompt terjelaskan, dan ada kurva token yang independen mendukungnya.

---

## 1. Analisis ulang 30 pengukuran

### 1.1 Fakta yang tetap berdiri

- Quota idle stabil sebelum pengukuran (`40963366` → `40963366`).
- 30 dari 30 request HTTP 200, `quotaDelta == dashboardDelta` di semua baris. Tidak ada traffic lain selama pengukuran.
- Multiplier katalog terbukti dipakai. Setiap `quotaDelta / multiplier` jatuh ke unit yang sama lintas model:

| Varian | kimi 1x | glm 2x | deepseek 2.56x | gemini 60x | gpt-6-luna 8x |
|---|---:|---:|---:|---:|---:|
| short (89 chars) | 2048 | 2048 | 2048,05 | 2048 | 5741,5 |
| long_prompt (7024 chars) | 3375 | 3375 | 3375 | 3375 | 7101,5 |
| long_output (~179 completion) | 2048 | 2048 | 2048,05 | 2048 | 5740,5 |

- Completion 29 dan 179 token menghasilkan base unit identik untuk varian short vs long_output pada model yang sama. Output tidak menaikkan base unit selama masih di bawah ambang tertentu.
- Cached token (51 pada empat model, 1000 pada gemini, 465–664 pada gpt-6-luna) tidak terlihat mengubah base unit.
- Reasoning token gpt-6-luna (11–27) tidak menambah base unit di luar `prompt_tokens + 1024`.

### 1.2 Temuan baru: input yang ditagih bukan `prompt_tokens` yang dilaporkan

Untuk varian `long_prompt` (prompt identik, 7024 karakter), lima model menerima prompt yang sama persis:

| Model | `prompt_tokens` dilaporkan | Base unit terukur | Base unit − 1024 |
|---|---:|---:|---:|
| gemini-4-argon | **2351** | 3375 | **2351** |
| kimi-k2.7-code | 1730,5 | 3375 | 2351 |
| glm-5.3 | 1727,0 | 3375 | 2351 |
| deepseek-v4.1-flash | 1724,5 | 3375 | 2351 |
| gpt-6-luna | 6077,5 | 7101,5 | 6077,5 |

Empat model non-gpt menerima prompt yang sama dan ditagih base unit yang sama (3375). Tiga di antaranya melaporkan `prompt_tokens` sekitar 1727, sedangkan gemini melaporkan 2351. `baseUnit − 1024 = 2351` persis, dan 2351 adalah angka yang dilaporkan gemini untuk prompt identik.

Interpretasi paling sederhana: **`tokenInputBilling` untuk prompt itu adalah 2351 untuk keempat model**. Gemini melaporkan angka billing dengan benar; kimi, glm, dan deepseek melaporkan angka yang lebih kecil.

### 1.3 Mengapa short tidak memberi informasi input

Untuk semua varian prompt pendek, `tokenInputBilling + 1024 < 2048`, sehingga formula di-clamp ke lantai 2048. Baik input benar 30 (perkiraan) maupun 1000 (angka gemini), hasilnya tetap 2048.

| Model | `prompt_tokens` short | `prompt + 1024` | `max(2048, ...)` | Base aktual |
|---|---:|---:|---:|---:|
| kimi | 366,5 | 1390,5 | 2048 | 2048 |
| glm | 364,5 | 1388,5 | 2048 | 2048 |
| deepseek | 362,5 | 1386,5 | 2048 | 2048 |
| gemini | 1000 | 2024 | 2048 | 2048 |

Karena short selalu kena lantai, satu-satunya varian kontrol yang benar-benar mengungkap nilai input adalah `long_prompt`. Itu sebabnya kegagalan sebelumnya hanya muncul di long_prompt: hanya di situ base unit keluar dari lantai.

### 1.4 Verifikasi independen dari data medium

`tmp/upstream-billing-verify.json` berisi request deepseek tambahan dengan prompt 10062 karakter: `quotaDelta = 11233`, multiplier 2,56.

```
base = 11233 / 2.56 = 4387.89 ≈ 4388
tokenInputBilling = 4388 − 1024 = 3364
```

Sementara `prompt_tokens` yang dilaporkan hanya 1614. Jika kurva token internal dari long_prompt (7024 chars → 2351 tokens ≈ **0,335 token/karakter**) dipakai:

```
10062 chars × 0.335 ≈ 3368  (base diprediksi = 4392)
```

Selisih 4 token dari 3364 pengukuran. Ini bukti independen bahwa input yang ditagih mengikuti kurva tokenizer yang stabil dan berbeda dari `prompt_tokens` yang dilaporkan. Catatan penting: deepseek melaporkan 1724 token untuk 7024 chars tetapi hanya 1614 token untuk 10062 chars. Lebih banyak karakter, token yang dilaporkan justru lebih sedikit. **`prompt_tokens` yang dilaporkan tidak bisa diandalkan sebagai input billing.**

### 1.5 Mengapa formula kandidat gagal (jawaban pertanyaan 4)

Formula sebelumnya gagal pada long_prompt kimi, glm, dan deepseek **bukan karena bentuk rumusnya salah**, tetapi karena memakai `prompt_tokens` yang dilaporkan (~1727) sebagai input, padahal input yang ditagih adalah 2351.

```
Kandidat lama:   max(2048, 1727 + 1024) = 2751     (aktual 3375) → gagal
Kandidat benar:  max(2048, 2351 + 1024) = 3375     (aktual 3375) → cocok
```

Kesalahan 624 token per request long_prompt. Itu menjelaskan mengapa hanya kasus long_prompt yang gagal dan mengapa semua kasus short/long_output tetap lolos (keduanya kena lantai 2048).

---

## 2. Tabel hasil pengukuran per model

Base unit = `quotaDelta / multiplierKatalog`. Semua dari 30 request terkontrol (`tmp/bankai-multiplier-measurements.json`).

| Model | Mult | Varian | `prompt_tokens` lap. | `completion` lap. | `cached` lap. | `reasoning` lap. | Base unit | Sumber |
|---|---:|---|---:|---:|---:|---:|---:|---|
| kimi-k2.7-code | 1x | short | 366,5 | 29 | 51 | 0 | 2048 | 2 req |
| kimi-k2.7-code | 1x | long_prompt | 1730,5 | 29 | 51 | 0 | 3375 | 2 req |
| kimi-k2.7-code | 1x | long_output | 368,5 | 179 | 51 | 0 | 2048 | 2 req |
| glm-5.3 | 2x | short | 364,5 | 29 | 51 | 0 | 2048 | 2 req |
| glm-5.3 | 2x | long_prompt | 1727,0 | 29 | 51 | 0 | 3375 | 2 req |
| glm-5.3 | 2x | long_output | 364,5 | 179 | 51 | 0 | 2048 | 2 req |
| deepseek-v4.1-flash | 2,56x | short | 362,5 | 29 | 51 | 0 | 2048,05 | 2 req |
| deepseek-v4.1-flash | 2,56x | long_prompt | 1724,5 | 29 | 51 | 0 | 3375 | 2 req |
| deepseek-v4.1-flash | 2,56x | long_output | 362,0 | 179 | 51 | 0 | 2048,05 | 2 req |
| deepseek-v4.1-flash | 2,56x | medium (10062c) | 1614 | 2 | 65 | 0 | 4387,89 | 1 req |
| gpt-6-luna | 8x | short | 4717,5 | 42,5 | 465 | 17 | 5741,5 | 2 req |
| gpt-6-luna | 8x | long_prompt | 6077,5 | 37,5 | 508 | 11 | 7101,5 | 2 req |
| gpt-6-luna | 8x | long_output | 4716,5 | 149 | 476 | 21 | 5740,5 | 2 req |
| gemini-4-argon | 60x | short | 1000 | 1000 | 1000 | 0 | 2048 | 2 req |
| gemini-4-argon | 60x | long_prompt | 2351 | 1000 | 1000 | 0 | 3375 | 2 req |
| gemini-4-argon | 60x | long_output | 1000 | 1000 | 1000 | 0 | 2048 | 2 req |

Catatan: `completion 1000` dan `cached 1000` pada gemini muncul di semua request termasuk `max_tokens: 64`, dan gemini mengembalikan `503` (`AI provider temporarily unavailable`). Angka gemini hanya dipakai sebagai indikator input, bukan sebagai bukti output atau caching.

---

## 3. Hipotesis formula per model

### 3.1 Terverifikasi

1. **Bentuk perkalian.** `quotaDelta = ceil(baseUnit × multiplierKatalog)`. Terbukti pada kelima model, tiga varian, dua pengulangan.
2. **Lantai 2048.** Terlihat pada kimi, glm, deepseek, gemini untuk semua request dengan input kecil. 2048 = 2 × 1024.
3. **Blok 1024 untuk output.** Output 29 dan 179 token tidak menaikkan base unit. Blok 1024 menutup output hingga setidaknya 179 token.
4. **gpt-6-luna: `baseUnit = prompt_tokens + 1024`.** Cocok tepat pada 6 dari 6 request (selisih < 1). Input yang ditagih sama dengan `prompt_tokens` yang dilaporkan.
5. **gemini: `baseUnit = max(2048, prompt_tokens + 1024)`.** Cocok tepat pada 6 dari 6 request.

### 3.2 Hipotesis kuat, belum terverifikasi

6. **Satu formula umum berlaku untuk semua model:**

   ```
   baseUnit = max(2048, tokenInputBilling + 1024)
   ```

   dengan `tokenInputBilling` adalah hitungan token internal. Cocok untuk **30 dari 30** request jika `tokenInputBilling` untuk long_prompt = 2351 dan short ≤ 1024.

7. **`tokenInputBilling ≠ prompt_tokens` untuk kimi, glm, deepseek.** Untuk prompt 7024 karakter, input billing = 2351, sedangkan yang dilaporkan 1724–1731. Bukti: base unit 3375 − 1024 = 2351 = angka gemini untuk prompt identik.
8. **Kurva token internal ≈ 0,335 token/karakter** pada rentang 7024–10062 karakter untuk deepseek. Didukung dua titik independen (long_prompt dan medium).
9. **`tokenInputBilling` untuk gpt-6-luna mencakup blok tersembunyi.** Delta 1360 token untuk 6935 karakter tambahan (≈ 0,196 token/karakter) menunjukkan ada prefix tersembunyi besar yang bukan bagian dari prompt pengguna.

### 3.3 Yang ditolak

10. `quotaDelta = total_tokens × multiplier`. Ditolak keras; error 5–13 kali lipat untuk model blok.
11. `cached_tokens` atau `reasoning_tokens` sebagai komponen billing terpisah. Tidak ada bukti menaikkan base unit pada request yang diuji.
12. Kegagalan long_prompt sebagai "tier kedua di 3375". Hipotesis tier tidak diperlukan lagi; penjelasan input 2351 lebih sederhana dan cocok untuk gemini tanpa tier tambahan.

### 3.4 Formula per model vs formula umum (pertanyaan 5)

Bukti mengarah ke **satu formula umum dengan parameter berbeda**, bukan lima formula terpisah:

- Bentuk `max(2048, input + 1024)` berlaku untuk kelima model.
- Perbedaan antar model hanya pada **cara memperoleh `tokenInputBilling`**:
  - gemini: gunakan `prompt_tokens` yang dilaporkan.
  - gpt-6-luna: gunakan `prompt_tokens` yang dilaporkan (sudah termasuk prefix tersembunyi).
  - kimi/glm/deepseek: `prompt_tokens` yang dilaporkan **under-count**; perlu kurva token internal atau faktor koreksi.
- Multiplier katalog menangani perbedaan tarif per model. Tidak ada indikasi tarif berbeda per request type.

---

## 4. Kondisi yang belum terverifikasi

Diurutkan berdasarkan dampak ke akurasi billing.

| # | Kondisi | Dampak | Bukti sekarang | Prioritas |
|---|---|---|---|---|
| 1 | `tokenInputBilling` untuk kimi/glm/deepseek | Tinggi. Salah input = salah tagih 600+ token per request panjang | 2 titik (2351, 3364) | Kritis |
| 2 | Ambang output 1024. Apakah completion > 1024 menaikkan base unit? | Tinggi. Output panjang tak teruji | Output maksimum diuji 179 token | Kritis |
| 3 | Bentuk kurva antara lantai 2048 dan 3375 | Tinggi. Prompt menengah belum diuji | Kosong antara ~1024 dan 2351 input | Kritis |
| 4 | Pertumbuhan base unit di atas 2351 input | Sedang–tinggi. Prompt besar tak teruji | Hanya 2 titik (2351, 3364) | Tinggi |
| 5 | Reasoning token besar (di atas 1024) pada gpt-6-luna | Sedang. Reasoning 11–27 terlalu kecil | Belum teruji | Sedang |
| 6 | Diskon cached token | Sedang. Cache 1000 di gemini, 51 di lain | Cache tidak terlihat mengubah base | Sedang |
| 7 | Apakah baris pertama setelah idle selalu ter-flush | Sedang. Probe gagal `quotaDelta=0` menandakan flush tertunda | 18 request probe gagal | Sedang |
| 8 | Stabilitas tokenizer untuk isi berbeda, panjang sama | Sedang. Diuji hanya variasi panjang | 7024 chars satu jenis isi | Sedang |
| 9 | Apakah ada tier tambahan di atas input > 3364 | Rendah–sedang | Belum ada bukti | Rendah |
| 10 | Traffic non-Rexu pada shared key | Tinggi saat produksi | Bukan masalah kalibrasi terisolasi | Operasional |

Catatan penting untuk #7: probe 17 November menghasilkan `quotaDelta=0` pada 18 request berurutan meski HTTP 200. Halaman dashboard kemungkinan meng-agregasi atau menunda penulisan, dan pembacaan `remainingTokens` tepat setelah request tidak selalu menangkap perubahan. Setiap eksperimen lanjutan **wajib** menunggu jeda stabil dan memverifikasi idle sebelum/sesudah, seperti pada pengukuran 30 request yang berhasil.

---

## 5. Rencana eksperimen lanjutan

Prinsip: satu variabel per batch, model termurah untuk pertanyaan umum (kimi 1x), model spesifik hanya jika diperlukan, selalu ada kontrol dan pengulangan, selalu ada idle check.

| ID | Tujuan | Model | Prompt chars | Repeats | Variabel yang diuji |
|---|---|---|---:|---:|---|
| E1 | Apakah completion > 1024 menaikkan base unit | kimi | 89 (short) | 2 | `max_tokens` ~1500, target output > 1024 |
| E2 | Kurva antara lantai 2048 dan 3375 | kimi | 3000 | 2 | input di antara 1024 dan 2351 |
| E3 | Reproduksi input 2351 | kimi | 7024 | 2 | ulang long_prompt, harus base 3375 |
| E4 | Kurva di atas 2351 | kimi | 15000 | 2 | pertumbuhan besar |
| E5 | Reasoning > 1024 | gpt-6-luna | 3000 | 2 | prompt reasoning-berat |
| E6 | Diskon cached | deepseek | 7024 | 2 | ulangi prompt identik untuk cache hit |
| E7 | Kestabilan tokenizer isi berbeda | glm-5.3 | 7024 | 2 | isi berbeda, panjang sama |

Total: **7 eksperimen × 2 = 14 request**.

E2 dan E3 adalah yang paling menentukan. E3 mengonfirmasi angka 2351 bisa direproduksi. E2 mengisi celah antara lantai dan 3375, yang menjadi sumber kegagalan utama formula saat ini.

Urutan pelaksanaan yang disarankan (hentikan jika hasil sudah konklusif):

1. **E3 dulu** (murah, 1x, memvalidasi metodologi sekaligus mereproduksi 2351).
2. **E2** (tiga titik: 3000, 4500, 5500 chars untuk memetakan transisi lantai → linear).
3. **E1** (batas output).
4. Sisanya sesuai kebutuhan.

---

## 6. Estimasi konsumsi kuota

Perhitungan memakai hipotesis `baseUnit = max(2048, input + 1024)` dengan `input ≈ 0,335 × chars` (kecuali gpt-6-luna, yang memakai `prompt_tokens` + prefix tersembunyi ≈ 4600 + 0,196 × chars).

| ID | Model | Mult | chars | Perkiraan base | Kuota/req | ×2 | Catatan |
|---|---|---:|---:|---:|---:|---:|---|
| E1 | kimi | 1x | 89 | 2048 | 2.048 | 4.096 | output panjang mungkin berbeda |
| E2 | kimi | 1x | 3000 | 2048–3029 | ~2.500 | 5.000 | interval, 3 titik → lihat bawah |
| E3 | kimi | 1x | 7024 | 3375 | 3.375 | 6.750 | harga pasti dari pengukuran |
| E4 | kimi | 1x | 15000 | ~6044 | 6.044 | 12.088 | estimasi |
| E5 | gpt-6-luna | 8x | 3000 | ~5188 | 41.504 | 83.008 | termahal; reasoning naikkan |
| E6 | deepseek | 2,56x | 7024 | 3375 | 8.640 | 17.280 | — |
| E7 | glm-5.3 | 2x | 7024 | 3375 | 6.750 | 13.500 | — |

Batas bawah dan atas:

- **Dasar (E1, E3, E4, E5, E6, E7, 2 repeat):** ± **137.000 kuota**.
- **Dengan E2 (3 titik, 2 repeat, ±7.500/req ≈ 45.000):** total ≈ **182.000 kuota**.
- **Buffer 15% (retry/503):** ≈ **210.000 kuota**.

Untuk skala: kuota berjalan sekitar 40,9 juta pada saat pengukuran. Eksperimen ini menghabiskan **kurang dari 0,5%** dari saldo yang teramati. E5 (gpt-6-luna) menyumbang lebih dari setengah biaya karena multiplier 8x; jika anggaran ketat, E5 bisa ditunda tanpa menghambat validasi formula umum.

Semua angka adalah **estimasi**, bukan hasil. Estimasi ini tidak boleh dipakai sebagai kuota aktual.

---

## 7. Kriteria validasi formula

Formula baru boleh dianggap cukup tervalidasi untuk **dry-run billing** (belum memotong wallet) jika **semua** kondisi berikut terpenuhi:

1. **Cakupan uji.** Minimal 3 titik input untuk setiap kelas model (blok dan gpt), mencakup:
   - input di bawah lantai (< 1024),
   - input di antara lantai dan 2351,
   - input di atas 2351 (minimal dua titik).
2. **Akurasi.** Pada setiap titik, `ceil(baseUnit_prediksi × multiplier)` sama dengan `quotaDelta` yang diukur, atau selisih ≤ 1 unit karena pembulatan. Tidak boleh ada error > 1%.
3. **Reproduksibilitas.** Setiap titik diulang minimal dua kali dan memberi base unit identik (± 1 unit).
4. **Batas output.** Ada minimal satu pengukuran dengan completion > 1024 yang mengonfirmasi apakah blok 1024 berubah menjadi bertingkat atau tetap.
5. **Kontrol bersih.** Setiap batch punya idle check stabil sebelum dan sesudah, serta `quotaDelta == dashboardDelta`.
6. **Input terverifikasi.** Untuk kimi/glm/deepseek, ada bukti bahwa `tokenInputBilling` dapat dihitung ulang atau dikoreksi dari data yang tersedia di produksi (bukan hanya besaran yang dibaca mata).
7. **gpt-6-luna konsisten.** `baseUnit = prompt_tokens + 1024` bertahan di semua titik baru.

Jika 7 kondisi ini lolos, formula boleh masuk **dry-run** (Tahap 4 di `docs/billing-design.md`): dihitung dan disimpan, tetapi tidak memotong wallet, minimal 7 hari, dengan coverage dilaporkan per model per hari.

Billing penuh (`BILLING_ENABLED=true`) hanya boleh setelah dry-run menunjukkan selisih agregat stabil dan kecil, dan `BILLING_UPSTREAM_PARITY_VERIFIED=true` hanya setelah coverage halaman BankAI cocok dengan quota delta pada periode uji.

Kondisi gagal yang menghentikan proses: ada titik dengan error > 1% yang tidak bisa dijelaskan, atau input billing tidak dapat dihitung dari data produksi.

---

## 8. Bagaimana hasil dipakai untuk memotong kuota pelanggan secara konsisten

Ini menjawab pertanyaan terakhir, dengan batasan nyata dari data.

### 8.1 Yang bisa dipakai sekarang

Untuk gemini-4-argon dan gpt-6-luna, formula sudah cocok dengan `prompt_tokens` yang dilaporkan:

```
gemini:      baseUnit = max(2048, prompt_tokens + 1024)
gpt-6-luna:  baseUnit = prompt_tokens + 1024
deducted     = ceil(baseUnit × multiplier)   → sama dengan kuota yang dipotong BankAI
```

Untuk kedua model ini, pemotongan pelanggan bisa **persis** sama dengan pemotongan upstream per request, karena input billing tersedia di respons.

### 8.2 Yang belum bisa dipakai

Untuk kimi, glm, dan deepseek, input billing (2351 untuk prompt 7024 karakter) tidak tersedia di respons. Yang tersedia hanya `prompt_tokens` (~1727). Selama koreksi input belum bisa dihitung dari data produksi, tiga model ini **tidak boleh** memakai formula untuk menagih pelanggan.

Dua pilihan yang sah saat ini:

- **A. Tunda billing** untuk tiga model sampai kurva input internal terverifikasi. Aman, tetapi pelanggan model tersebut belum bisa ditagih.
- **B. Pakai angka konservatif yang terbukti aman.** Untuk request panjang, gunakan base unit yang diketahui dari calibration table berdasarkan rentang panjang prompt, bukan dari `prompt_tokens`. Ini tetap butuh kalibrasi untuk rentang prompt di luar 7024 karakter, jadi belum lengkap.

### 8.3 Aturan konsistensi lintas model

Agar tidak ada pelanggan yang dirugikan atau Rexu tekor:

1. **Satu driver, satu arah.** `deducted_customer` adalah satu-satunya yang menyentuh wallet. `quotaDelta_actual` hanya untuk kalibrasi dan rekonsiliasi agregat. Tidak boleh ada penyesuaian wallet dari delta global.
2. **Snapshot per request.** Setiap usage log menyimpan `formula_version`, `base_unit`, `token_input_billing`, `multiplier_bp`, dan `deducted_tokens`. Semua imutabel setelah settlement.
3. **Konsisten dengan upstream.** Target `deducted_customer == quotaDelta` per request pada model yang tervalidasi. Untuk model yang belum tervalidasi, billing tidak dijalankan.
4. **Buffer hanya dari data.** Buffer coverage ditetapkan dari pengukuran coverage harian, bukan asumsi harga. Jangan mengarang persentase.
5. **Transparansi.** Lantai 2048 harus dinyatakan jelas ke pelanggan sebelum billing aktif, karena request 20 token ditagih setara 2048 unit. Ini mungkin benar di upstream, tetapi pelanggan berhak tahu.
6. **Tidak ada koreksi retroaktif.** Kesalahan formula tidak dibebankan ulang ke pelanggan. Selisih agregat menjadi biaya Rexu dan memicu kalibrasi.

### 8.4 Ringkas

Pemotongan pelanggan yang konsisten menuntut formula yang sama dengan upstream, dan itu sudah hampir tercapai. Yang tersisa adalah menghitung `tokenInputBilling` untuk tiga model blok dari data produksi. Tanpa itu, billing untuk kimi, glm, dan deepseek hanya bisa ditunda; gemini dan gpt-6-luna sudah cukup untuk diuji.

---

## 9. Kesimpulan

- Kegagalan formula sebelumnya terjelaskan: input yang dipakai salah, bukan bentuk rumusnya.
- Satu formula umum `max(2048, tokenInputBilling + 1024) × multiplier` cocok untuk 30 dari 30 request, dengan `tokenInputBilling` sebagai satu-satunya ketidaktahuan.
- Kurva token internal ≈ 0,335 token/karakter didukung dua titik independen.
- Eksperimen lanjutan minimal 14 request, estimasi ± 140.000–210.000 kuota (di bawah 0,5% saldo yang teramati). E2 dan E3 paling menentukan.
- Formula belum boleh dipakai untuk billing. Setidaknya 7 kriteria validasi di bagian 7 harus lolos lebih dulu.
- `BILLING_ENABLED=false` dan `BILLING_UPSTREAM_PARITY_VERIFIED=false` tetap sampai validasi selesai.

Tidak ada request BankAI yang dikirim untuk menyusun dokumen ini. Tidak ada kode, database, atau hasil pengukuran lama yang diubah.

---

## 10. Rekonsiliasi temuan agregat terbaru

Bagian ini menjawab temuan baru dan merekonsiliasikannya dengan laporan sebelumnya. **Kesimpulan utama: tidak ada kontradiksi nyata.** Angka agregat baru justru **memperkuat** bukti bahwa multiplier berlaku. Yang selama ini terlihat sebagai kontradiksi adalah perbandingan dua besaran berbeda.

### 10.1 Data temuan baru

- `usage.total_tokens`: **75.010.271**
- Total kuota dibeli (`maxTokens`): **95.000.000**
- Dashboard kuota terpakai: sekitar **75,01 juta**
- Dashboard sisa kuota: sekitar **19,99 juta**

Perhitungan silang:

```
95.000.000 − 75.010.271 = 19.989.729
```

Angka 19.989.729 sama dengan "sekitar 19,99 juta". Jadi `remaining + usage.total_tokens = maxTokens` berlaku persis.

### 10.2 Audit sumber data dan metode

Seluruh bukti lama berasal dari endpoint dan field yang sama:

| Sumber | Endpoint/field | Isi |
|---|---|---|
| `bankai-verify.json` | `GET /v1/quota` | `remainingTokens`, `maxTokens`, `usage` (termasuk `usage.total_tokens`) |
| `bankai-multiplier-measurements.json` | `GET /v1/quota` sebelum & sesudah tiap request | `remainingTokens`, `usageTotalTokens`, `requests` |
| `bankai-multiplier-measurements.json` | `POST /v1/chat/completions` | `usage.prompt_tokens`, `completion_tokens`, `total_tokens` (respons model) |
| `upstream-billing-verify.json` | keduanya | delta kuota vs usage respons |

Dua hal penting yang sering tertukar:

1. **`usage.total_tokens` yang dibahas di temuan baru** adalah field di objek `usage` milik `GET /v1/quota` (counter akun/key), **bukan** `usage.total_tokens` di respons `chat/completions` (token mentah satu respons).
2. Di data lama, field kuota ini disimpan dengan nama `usageTotalTokens`. Nama berbeda, sumber sama. Nilainya pada 30 request: **54.036.634 → 55.313.568**, bertambah **1.276.934**, sama persis dengan jumlah 30 `quotaDelta` dan sama persis dengan penurunan `remainingTokens`.

### 10.3 Apakah ketiganya mengukur unit yang sama?

**Ya untuk dashboard dan delta per request. Tidak untuk token mentah respons.**

Bukti dari 30 request (identitas diperiksa baris per baris):

- Pada **30 dari 30** baris, `Δ usageTotalTokens == Δ remainingTokens == quotaDelta`. Tidak ada pengecualian.
- Total Δ `usageTotalTokens` (1.276.934) = total Δ `remainingTokens` (1.276.934) = jumlah 30 `quotaDelta` (1.276.934).
- Sebaliknya, jumlah `usage.total_tokens` mentah dari respons hanya **62.346**, sekitar **20,5x** lebih kecil dari counter kuota.

Artinya:

- **Kuota dashboard ≡ counter `usage.total_tokens` (level key) ≡ akumulasi `quotaDelta` per request.** Ini satu unit yang sama, terbukti.
- **Token mentah respons** (`prompt + completion`) adalah besaran berbeda, dikali/diskala sebelum masuk counter. Ini sumber kebingungan lama.

### 10.4 Perbedaan sumber yang diperiksa

| Kemungkinan | Hasil pemeriksaan | Vonis |
|---|---|---|
| Endpoint berbeda | Lama & baru sama-sama dari `GET /v1/quota` (`usage`/`usageTotalTokens`, `remainingTokens`) | Tidak ada perbedaan endpoint |
| Cakupan akun/API key | Invariant `remaining + usage = 95.000.000` cocok di **kedua** snapshot lama dan di temuan baru | Akun & key sama |
| Periode pengukuran | Lama: 2026-11-16 (241→271 request). Baru: akumulasi setelahnya | Sama counter, beda waktu |
| Keterlambatan sinkronisasi | `quotaDelta == dashboardDelta` di 30/30 baris; idle stabil | Tidak ada lag pada run yang berhasil |
| Mekanisme multiplier | `quotaDelta / multiplier` konsisten lintas model | Multiplier **berlaku**, bukan gugur |

### 10.5 Perubahan agregat antar-snapshot

Invariant yang membuktikan counter yang sama:

```
remaining(start) + usageTotal(start) = 40.963.366 + 54.036.634 = 95.000.000
remaining(end)   + usageTotal(end)   = 39.686.432 + 55.313.568 = 95.000.000
```

Pertumbuhan dari akhir pengukuran lama ke snapshot baru:

```
75.010.271 − 55.313.568 = 19.696.703
```

Pertumbuhan 19,70 juta ini **tidak boleh dan tidak bisa** dilekatkan ke satu request atau satu model tertentu. Data yang ada tidak menyimpan rincian per model untuk rentang ini. Yang tercatat hanya:

- request naik dari 271 (akhir run lama) ke jumlah yang tidak diketahui di snapshot baru,
- `usage.total_tokens` naik 19.696.703.

Tidak ada cara sah membagi angka itu per model tanpa snapshot request yang sepadan. Karena itu pertumbuhan ini **tidak dipakai** untuk menyimpulkan apa pun tentang formula atau multiplier.

### 10.6 Apakah bukti mentah lama cukup untuk dibandingkan?

Cukup untuk **identitas counter**, tidak cukup untuk **atribusi per model** pada rentang antar-snapshot.

- **Cukup:** 30 baris request menyimpan `quotaBefore`, `quotaAfter`, `quotaDelta`, `dashboardDelta`, `usage` respons, dan `requests`. Ini memungkinkan verifikasi `Δremaining = ΔusageTotal = quotaDelta` sampai tingkat baris, dan invariant 95.000.000.
- **Tidak cukup:** tidak ada daftar request antara akhir run lama dan snapshot baru. Snapshot baru hanya memberi satu angka agregat. Tidak ada pembagian per model, per endpoint, atau per waktu untuk 19,70 juta itu.
- `bankai-base-unit-probes.json` (probe gagal) tetap tidak dipakai: 18 request `quotaDelta=0` karena masalah flush, bukan bukti unit.

### 10.7 Kesimpulan: terbukti, hipotesis, bertentangan

**Terbukti (bisa dipertahankan):**

1. `remaining + usage.total_tokens = maxTokens (95.000.000)` berlaku di kedua snapshot lama. Ini identitas akun/key.
2. Kuota dashboard, counter `usage.total_tokens` level key, dan akumulasi `quotaDelta` per request adalah **unit yang sama**. 30/30 baris konsisten, total agregat identik.
3. Multiplier katalog berlaku pada unit counter kuota. `quotaDelta / multiplier` jatuh ke base unit yang konsisten lintas model.
4. Token mentah respons ≠ counter kuota; rasio sekitar 20,5x pada 30 request. Ini menjelaskan "selisih" lama.

**Hipotesis (belum final):**

5. Formula `max(2048, tokenInputBilling + 1024) × multiplier` (bagian 3). Bentuknya kuat, tetapi `tokenInputBilling` untuk kimi/glm/deepseek belum bisa dihitung dari data produksi.
6. Kurva token internal ≈ 0,335 token/karakter. Dua titik, belum cukup untuk prompt di luar rentang uji.
7. Ambang output 1024 dan perilaku completion > 1024.

**Bertentangan — ternyata bukan:**

8. "Agregat `usage.total_tokens` ≈ kuota terpakai dashboard" **konsisten** dengan "delta per request = baseUnit × multiplier", karena keduanya mengukur counter yang sama. Kecocokan agregat ini **tidak** membatalkan multiplier. Sebaliknya, itu bukti pendukung: counter itulah yang diisi oleh `baseUnit × multiplier` per request.
9. "Selisih kuota per request vs `response.usage.total_tokens`" (dari `upstream-billing-verify.json`, ratio 6,95–14,52x) bukan kontradiksi formula, melainkan perbandingan dua besaran berbeda (mentah vs counter).

### 10.8 Catatan metodologis

Temuan agregat baru tidak mengubah status `BILLING_ENABLED=false`. Angka 75,01 juta adalah **total pemakaian akun sejak awal**, bukan hasil eksperimen terkontrol. Ia berguna untuk memverifikasi identitas counter, tetapi tidak bisa menggantikan pengukuran per request untuk menentukan `tokenInputBilling`.

Perlu ditegaskan: **jangan** menyimpulkan "multiplier tidak berlaku" dari kecocokan agregat, dan **jangan** menyimpulkan "formula final" dari identitas counter. Dua hal itu sudah dipisahkan di atas.

---

## 11. Rekomendasi eksperimen eksplorasi terkecil (belum disetujui)

Kontradiksi unit sudah selesai. Yang tersisa adalah ketidaktahuan nyata: **`tokenInputBilling` untuk kimi/glm/deepseek tidak dapat dihitung dari `prompt_tokens` yang dilaporkan.** Empat request berikut adalah **eksperimen eksplorasi** untuk menguji reproduksibilitas dan pola `tokenInputBilling`/base unit, bukan validasi formula final.

Temuan yang sudah ada (koefisien 0,335 belum dapat dianggap benar):
- 7024 × 0,335 = 2353,04, sedangkan input billing yang diinferensikan adalah 2351 (selisih 2,04).
- 10062 × 0,335 = 3370,77, sedangkan input billing yang diinferensikan adalah 3364 (selisih 6,77).
- Koefisien 0,335 **tidak** memenuhi kriteria akurasi ±1 unit; ia tetap hipotesis kasar, bukan dasar penagihan.

Eksperimen yang diusulkan (semua belum dijalankan, butuh persetujuan, memakai kuota):

| Prioritas | ID | Model | Multiplier | Yang diuji | Request | Base unit per request (estimasi) | Estimasi kuota |
|---|---|---|---:|---|---:|---|---:|
| 1 | R1 | kimi-k2.7-code | 1 | Reproduksibilitas: ulang `long_prompt` 7024c, amati apakah base unit/input billing terinferensi konsisten dengan data lama (base 3375, input terinferensi 2351) | 2 | 3.375 (target reproduksi dari data lama) | 2 × 1 × 3.375 = **6.750** |
| 2 | R2 | kimi-k2.7-code | 1 | Pola/transisi: prompt 3000c dan 4500c untuk memetakan posisi relatif terhadap lantai 2048 dan titik 7024c | 2 | 2.048–3.375 per request (rentang teramati kimi: lantai 2048 s.d. base 7024c 3375; nilai aktual belum diketahui) | 2 × 1 × (2.048–3.375) = **4.096–6.750** |

**Estimasi total:** 10.846–13.500 kuota (dihitung dari `multiplier × base unit` tiap request; batas atas R2 konservatif memakai base 3375).

Alasan eksplorasi ini minimal:
- **R1** menguji reproduksibilitas pada titik 7024c (multiplier 1x). Hasilnya menunjukkan apakah base/input billing terinferensi stabil, tanpa mengasumsikan koefisien karakter→token tertentu.
- **R2** memberi dua titik (3000c, 4500c) untuk mengamati pola transisi dari lantai 2048 menuju 3375. Tujuannya memetakan perilaku, bukan mencocokkan ke `0,335 × chars`.
- Model lain, output panjang, reasoning, dan cache tidak diuji dulu karena pertanyaan terbuka utama adalah pola `tokenInputBilling` pada model blok.

Kriteria interpretasi (eksplorasi, bukan syarat aktivasi billing):
- **R1:** bandingkan `quotaDelta`/base unit teramati dengan 3375 dan inferensi input 2351 dari data lama. Konsisten → titik 7024c reproduksibel; tidak konsisten → metodologi/pola perlu diperiksa sebelum inferensi lanjutan.
- **R2:** catat base unit teramati pada 3000c dan 4500c untuk melihat apakah masih di lantai 2048, sudah naik, atau mendekati 3375. Hasil dipakai untuk membentuk hipotesis kurva kandidat.
- **Koefisien 0,335 tidak digunakan sebagai kriteria lulus/gagal.** Kecocokan atau ketidakcocokan dengan `max(2048, 0,335×chars + 1024)` hanya dicatat sebagai observasi, bukan bukti kebenaran koefisien.
- Jika pola belum cukup untuk hipotesis yang sempit, titik tambahan (mis. antara 3000c–4500c) dapat dipertimbangkan sebelum menyimpulkan.

Batas kesimpulan:
- Empat request ini **tidak** cukup untuk menyimpulkan model Kimi siap ditagih.
- Empat request ini **tidak** menetapkan formula final, koefisien karakter→token, atau nilai `tokenInputBilling` produksi.
- Penetapan billing Kimi membutuhkan bukti reproduksibilitas yang memadai, pemetaan pola yang konsisten, dan validasi sesuai bagian 7 sebelum dry-run/aktivasi apa pun.

Status: tidak ada request, perubahan kode, database, atau konfigurasi yang dilakukan. `BILLING_ENABLED=false`, `BILLING_UPSTREAM_PARITY_VERIFIED=false`. Seluruh hasil pengukuran lama tetap dipertahankan. Eksperimen ini menunggu persetujuan.
