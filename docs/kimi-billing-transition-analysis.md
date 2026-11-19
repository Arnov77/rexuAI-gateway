# Analisis Rentang Transisi Billing Kimi (`kimi-k2.7-code`)

Tanggal analisis: 2026-11-17  
Status: **analisis dan perencanaan saja**. Tidak ada request BankAI baru, tidak ada perubahan kode/database/konfigurasi, tidak ada pengaktifan billing. `BILLING_ENABLED=false`, `BILLING_UPSTREAM_PARITY_VERIFIED=false`.

## 1. Ringkasan hasil

- **Sumber utama (raw JSON, per request):** `tmp/bankai-multiplier-measurements.json` (6 request Kimi, 2026-11-16) dan `/tmp/opencode/kimi-billing-exploration.json` (R1/R2, 4 request, 2026-11-17). Keduanya terbaca dan dipakai; tidak ada duplikasi (ID/waktu/request counter berbeda).
- **Sumber pendukung/cek:** `tmp/upstream-billing-verify.json` (tidak memuat Kimi), `tmp/bankai-verify.json`, `docs/bankai-multiplier-report.md`, `docs/billing-design.md`, `docs/billing-calibration-plan.md`. `tmp/bankai-base-unit-probes.json` berisi 18 probe dengan `quotaDelta=0` (flush tertunda) dan **tidak dipakai sebagai bukti billing**.
- **Konsistensi pengukuran Kimi:** 10/10 request HTTP 200, `quotaDelta == dashboardDelta` pada semua baris, multiplier 1. Eksplorasi R1/R2 mencatat idle stabil sebelum run (`remainingTokens` 19.989.729 → 19.989.729). Rangkaian lama juga berada pada periode idle/kontrol terverifikasi (`quotaDelta == dashboardDelta`).
- **Fakta teramati (Kimi, prompt filler konsisten):** 89c (short/long_output, output 29–179) dan 3000c → base unit 2048 (lantai, `max(2048, tokenInputBilling + 1024)` ter-clamp). 4500c → base unit 2534 (di atas lantai). 7024c → base unit 3375, **direproduksi 6 kali** (2 lama + 2 R1) dengan base/input terinferensi identik.
- **Rentang transisi (hipotesis berbasis data):** ambang keluar lantai 2048 berada di antara **3000 dan 4500 karakter** untuk karakteristik prompt ini. Titik transisi pasti, bentuk kurva, dan generalisasi ke prompt lain **belum ditentukan**.
- **Kesiapan billing:** data **belum cukup** untuk formula billing Kimi, tabel kalibrasi runtime, atau dry-run billing. Koefisien karakter→token (mis. ~0,335) adalah observasi korelatif pada sampel terbatas, **bukan** formula/bukti (deviasi > ±1 pada titik terukur), dan tidak memenuhi syarat validasi.

## 2. Tabel seluruh pengukuran Kimi

Base unit teramati = `quotaDelta / multiplier` (multiplier Kimi = 1). Input billing terinferensi = `baseUnit - 1024` (dekomposisi asumtif dari hipotesis `baseUnit = max(2048, tokenInputBilling + 1024)`; pada lantai 2048 ini hanya batas atas efektif, bukan pengukuran langsung `tokenInputBilling`). Rasio = `quotaDelta / usage.total_tokens` respons.

| ID pengukuran | Prompt (char) | HTTP | `quotaDelta` | `dashboardDelta` | `prompt_tokens` | `completion_tokens` | `total_tokens` | `cached_tokens` | Base unit teramati | Input billing terinferensi | Kena minimum 2048 | Konsisten (`qd==dd`) | Pengulangan/konsistensi ulang | Sumber |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|:---:|---|---|
| M-short-r1 | 89 | 200 | 2048 | 2048 | 366 | 29 | 395 | 51 | 2048 | 1024 | ya | ya | short (89c) konsisten 2/2, base 2048 | measurements lama |
| M-long_output-r1 | 89 | 200 | 2048 | 2048 | 368 | 179 | 547 | 51 | 2048 | 1024 | ya | ya | long_output (89c) konsisten 2/2, base 2048 | measurements lama |
| M-short-r2 | 89 | 200 | 2048 | 2048 | 367 | 29 | 396 | 51 | 2048 | 1024 | ya | ya | short (89c) konsisten 2/2, base 2048 | measurements lama |
| M-long_output-r2 | 89 | 200 | 2048 | 2048 | 369 | 179 | 548 | 51 | 2048 | 1024 | ya | ya | long_output (89c) konsisten 2/2, base 2048 | measurements lama |
| R2-1 | 3000 | 200 | 2048 | 2048 | 940 | 29 | 969 | 51 | 2048 | 1024 | ya | ya | belum ada ulangan titik 3000c | eksplorasi R1/R2 |
| R2-2 | 4500 | 200 | 2534 | 2534 | 1232 | 29 | 1261 | 51 | 2534 | 1510 | tidak | ya | belum ada ulangan titik 4500c | eksplorasi R1/R2 |
| M-long_prompt-r1 | 7024 | 200 | 3375 | 3375 | 1730 | 29 | 1759 | 51 | 3375 | 2351 | tidak | ya | 7024c konsisten 6/6, base 3375 | measurements lama |
| M-long_prompt-r2 | 7024 | 200 | 3375 | 3375 | 1731 | 29 | 1760 | 51 | 3375 | 2351 | tidak | ya | 7024c konsisten 6/6, base 3375 | measurements lama |
| R1-1 | 7024 | 200 | 3375 | 3375 | 1726 | 29 | 1755 | 51 | 3375 | 2351 | tidak | ya | 7024c konsisten 6/6, base 3375 (R1 ulangan eksplisit) | eksplorasi R1/R2 |
| R1-2 | 7024 | 200 | 3375 | 3375 | 1726 | 29 | 1755 | 51 | 3375 | 2351 | tidak | ya | 7024c konsisten 6/6, base 3375 (R1 ulangan eksplisit) | eksplorasi R1/R2 |

**Agregat ringkas per titik ukuran (deduplikasi logis, bukan penghapusan data):**
- 89c, output pendek/panjang (4 baris): base 2048, lantai.
- 3000c (1 baris): base 2048, lantai.
- 4500c (1 baris): base 2534, di atas lantai.
- 7024c (6 baris, dua sesi/waktu berbeda): base 3375, sangat stabil.

## 3. Analisis rentang transisi

### 3.1 Rentang yang masih pada minimum 2048
- **Teramati di lantai:** 89 karakter (prompt pendek, `prompt_tokens` respons 366–369) dan 3000 karakter (`prompt_tokens` 940), keduanya base 2048.
- **Batas bawah transisi dari data:** masih lantai pada 3000c. Tidak ada titik ukur antara 3000c dan 4500c, sehingga batas atas rentang-lantai belum diketahui (bisa tepat di atas 3000c atau mendekati 4500c).

### 3.2 Rentang ketika base unit mulai naik di atas 2048
- **Teramati di atas lantai:** 4500c (base 2534, input terinferensi 1510) dan 7024c (base 3375, input terinferensi 2351).
- **Hipotesis rentang transisi (keluar lantai):** (3000c, 4500c] dalam karakter prompt, untuk karakteristik filler/struktur prompt yang sama seperti R2/long_prompt. Ini **bukan** titik pasti.

### 3.3 Bentuk hubungan (linear / piecewise linear / lain)
- **Yang didukung:** hubungan monoton naik terhadap panjang prompt teramati pada rentang 3000c→4500c→7024c (setelah keluar lantai).
- **Tidak cukup bukti untuk bentuk kurva:** hanya **2 titik ukuran di atas lantai** (4500c, 7024c) plus banyak ulangan pada ukuran yang sama (7024c). Dua titik selalu dapat dihubungkan garis, tetapi tidak membedakan linear, piecewise linear, step/kuantisasi token, atau fungsi lain. Lantai memperkuat kemungkinan bentuk *piecewise* (`max(2048, f(chars)+1024)`), namun `f` belum teridentifikasi.
- **Prediktor karakter:** panjang karakter berkorelasi dengan base unit pada sampel ini (prompt dengan komposisi/struktur serupa), tetapi **bukan prediktor tervalidasi**. Tokenisasi bergantung isi/encoding/tokenizer internal; 7024c menghasilkan `prompt_tokens` respons ~1726–1731 (beda kecil antar run) sementara base unit tetap 3375, menunjukkan pemisahan antara metrik respons dan counter billing.

### 3.4 Koefisien 0,335 dan batas interpretasi
- Observasi: koefisien ~0,335 char→input (dari titik di atas lantai) memberi estimasi dekat pada beberapa titik, tetapi **bukan kriteria/bukti**: missmatch/deviasi > ±1 pada titik terukur tetap ada (mis. prediksi ~2353 vs terinferensi 2351 pada 7024c; ~1507,5 vs 1510 pada 4500c; prediksi kontinu di bawah lantai tidak identik dengan clamp 2048). Koefisien ini **tidak diasumsikan benar** dan **tidak boleh** dipakai sebagai `tokenInputBilling = chars × k`.

## 4. Hipotesis yang masih masuk akal

| Hipotesis | Dukungan data | Yang bisa menggugurkan/melemahkan |
|---|---|---|
| H1. Lantai base unit 2048 berlaku sampai suatu ambang input billing (bentuk `max(2048, ·)` konsisten) | 89c dan 3000c di lantai; 4500c keluar lantai; pola konsisten dengan data lama | Titik di (3000,4500) dengan base < 2048 (tak teramati) atau base > 2048 tepat di dekat 3000c dengan pola tak selaras |
| H2. Ambang keluar lantai (prompt style ini) berada di (3000c, 4500c) | 3000c lantai, 4500c base 2534 | Pengukuran terkontrol di tengah rentang: 3500c/3750c lantai mendorong ambang ke atas; 3250c di atas lantai mendorong ke bawah |
| H3. Di atas lantai, base unit tumbuh monoton terhadap panjang prompt (mendekati linear/piecewise pada rentang sempit) | 4500c < 7024c; 7024c stabil | Titik tambahan menunjukkan plateau/step non-monoton atau penurunan (di luar noise kontrol) |
| H4. Panjang karakter adalah proksi yang cukup untuk rentang sempit dengan prompt serupa | Korelasi pada 3000/4500/7024c dengan filler konsisten | Prompt isi berbeda, panjang sama → base unit berbeda signifikan; atau tokenisasi internal tak selaras |
| H5. Input billing = base unit − 1024 (dan multiplier 1 untuk Kimi) pada titik terukur | Konsisten dengan semua 10 baris Kimi dan pola lintas model di dokumen lama | Perilaku output > 1024 atau kondisi lain mengubah komponen 1024; definisi resmi berbeda |

Tidak ada hipotesis di atas yang cukup untuk menetapkan formula produksi.

## 5. Rancangan eksperimen lanjutan (belum dijalankan, menunggu persetujuan)

**Tujuan:** mempersempit rentang transisi keluar minimum 2048 (3000–4500c) dengan kuota sesedikit mungkin, menguji reproduksibilitas, tanpa menyimpulkan formula.

### 5.1 Desain yang dipilih (berbasis data)
- **Fokus:** transisi lantai, karena ini celah terbesar yang relevan (3000c lantai, 4500c sudah naik). Titik 7024c sudah tereproduksi; eksplorasi output>1024/reasoning/caching adalah pertanyaan lain dan tidak memaksimalkan informasi per kuota untuk transisi ini.
- **Titik prompt:** **3500c** dan **4000c** (dua titik tengah seimbang di dalam [3000,4500], ~250c–500c resolusi per tahap tergantung hasil). Dipilih karena memaksimalkan informasi biner/interval terhadap ambang tak diketahui di rentang tersebut; bukan angka arbitrer.
- **Pengulangan:** 2× per titik (total 4 request) untuk memisahkan noise/fluktuasi dari sinyal transisi, sejalan dengan bukti bahwa titik stabil bisa direproduksi (7024c).
- **Parameter kontrol:** model `kimi-k2.7-code`, multiplier 1, `max_tokens` 64, `temperature` 0, `stream: false`, karakteristik teks/prefix/suffix/filler konsisten dengan R1/R2, ID unik hanya pada label konteks (jangan ubah distribusi token signifikan).
- **Prosedur kontrol:**
  1. Snapshot quota awal + verifikasi idle stabil (dua bacaan berjarak, delta 0) sebelum batch.
  2. Untuk setiap request: snapshot `remainingTokens` dan `usage.total_tokens` sebelum; kirim request; tunggu jeda cukup (≥1,5s, konsisten); snapshot sesudah. Catat HTTP, usage respons, `quotaDelta`, `dashboardDelta`, base unit teramati.
  3. Pastikan tidak ada traffic lain pada key selama batch; hentikan jika idle/konsistensi rusak.
  4. Simpan hasil ke file **baru** di `/tmp/opencode/` (tidak menimpa `kimi-billing-exploration.json` atau artefak lama).

### 5.2 Interpretasi hasil (dukung / gugurkan hipotesis)

| Hasil teramati | Dukungan | Implikasi |
|---|---|---|
| 3500c base 2048 (ulang konsisten) dan 4000c base 2048 | Mendukung H1,H2 (ambang bergeser ke >4000c) | Transisi lebih sempit: (4000,4500]; perlu titik >4000c bila dilanjutkan |
| 3500c base 2048 dan 4000c base > 2048 | Mendukung H1,H2,H3 | Transisi di (3500,4000]; estimasi karakter lebih sempit |
| 3500c base > 2048 dan 4000c base > 2048 | Mendukung H1,H3; **menggugurkan/melemahkan** ambang ≥3500c | Transisi di (3000,3500]; 4000c memberi titik kurva tambahan |
| 3500c/4000c tidak monoton atau hasil ulangan tidak konsisten | Melemahkan H3/H4/kontrol | Bentuk bukan sekadar fungsi panjang sederhana atau ada faktor tak terkontrol; jangan lanjut ke formula |
| `quotaDelta != dashboardDelta` atau idle berubah | Kontaminasi/metodologi | Hasil batch tidak valid untuk kesimpulan |

### 5.3 Estimasi konsumsi kuota (skenario, multiplier 1)

Referensi terukur: 2048 (lantai), 2534 (4500c), 3375 (7024c). Di atas lantai, nilai antara 2048–3375 masuk akal sebagai rentang sempit; estimasi bukan jaminan.

| Skenario | Asumsi per request | 3500c ×2 | 4000c ×2 | Total 4 req |
|---|---|---:|---:|---:|
| Minimum (semua lantai) | 2048 | 4096 | 4096 | **8192** |
| Tengah-A (3500 lantai, 4000 naik moderat ~2300–2400) | 2048 / 2350 | 4096 | 4700 | **~8796** |
| Tengah-B (keduanya naik moderat) | ~2150 / ~2350 | 4300 | 4700 | **~9000** |
| Tengah-C (dekat nilai 4500c) | ~2400 / ~2500 | 4800 | 5000 | **~9800** |
| Maksimum masuk akal (batas atas data Kimi) | 3375 | 6750 | 6750 | **13500** |

**Rekomendasi anggaran perencanaan:** siapkan **~8.200–13.500** kuota (batas terukur); ekspektasi tengah **~9.000–10.000** jika transisi berada di dalam rentang. Angka adalah estimasi, bukan komitmen aktual.

## 6. Evaluasi kesiapan billing

- **Apakah data sekarang sudah cukup untuk membuat formula billing Kimi?** **Tidak.** Titik di atas lantai terlalu sedikit (4500c, 7024c) dan hanya satu jenis prompt; bentuk `f`/kurva dan ambang pasti belum teridentifikasi.
- **Apakah input billing bisa dihitung dari data yang tersedia di Rexu saat runtime?** **Belum terbukti.** `usage.prompt_tokens` respons Kimi tercatat ~940 (3000c), ~1232 (4500c), ~1726–1731 (7024c) sementara base unit teramati 2048/2534/3375; pemetaan deterministik runtime dari field respons ke `tokenInputBilling`/base unit **tidak tersedia/tervalidasi**.
- **Jika belum, informasi apa yang masih hilang?** (a) ambang dan bentuk transisi 3000–4500c (dan titik tambahan bila perlu), (b) validasi pada variasi isi/panjang lain, (c) perilaku output/completion > 1024 terhadap base unit, (d) definisi/sumber resmi `tokenInputBilling` atau bukti pemetaan runtime yang stabil, (e) stabilitas terhadap caching/reasoning/prefix tersembunyi bila relevan, (f) kriteria akurasi ±1 unit pada titik uji.
- **Apakah pendekatan tabel kalibrasi aman atau berisiko undercharge/overcharge?** **Berisiko.** Interpolasi/ekstrapolasi di luar titik terukur dapat **undercharge** (Rexu tekor) atau **overcharge** (pelanggan dirugikan), terutama di sekitar transisi dan untuk prompt dengan tokenisasi berbeda. Tabel hanya aman sebagai titik uji/lookup eksak pada kondisi yang persis sama dan tervalidasi—belum terpenuhi.
- **Kriteria minimum sebelum Kimi boleh masuk dry-run billing:** multiplier/formula shape terkonfirmasi; `tokenInputBilling` atau base unit dapat dihitung deterministik dari data runtime; ≥3 titik input tervalidasi mencakup bawah-lantai, sekitar transisi, dan di atas lantai (dengan ulangan konsisten); perilaku output > 1024 teruji; `quotaDelta == dashboardDelta` dan idle bersih; akurasi prediksi = delta aktual (atau selisih hanya pembulatan ≤1 unit) pada window uji; dry-run menyimpan `formula_version/base_unit/deducted` tanpa memotong wallet dan menunjukkan paritas/cakupan stabil sebelum aktivasi. Prediksi `quotaDelta` dari panjang karakter saja **tidak** setara dengan kemampuan billing produksi per request.

## 7. Risiko dan keterbatasan data

- **Sampel kecil & bias prompt:** 10 request, satu model, komposisi prompt sangat mirip (filler berulang + label). Generalisasi lemah.
- **Karakter ≠ token billing:** korelasi bukan kausalitas; tokenizer/internal accounting dapat berbeda per isi/bahasa/struktur.
- **Dekomposisi asumtif:** `input billing terinferensi = base - 1024` bergantung pada hipotesis; bukan field resmi.
- **Titik tunggal tanpa ulangan:** 3000c dan 4500c masing-masing 1 pengukuran (meski konsisten secara internal); perlu replikasi.
- **Celah variabel:** output > 1024, reasoning besar, efek cache/prefix sistem, isi berbeda panjang sama—belum teruji untuk Kimi.
- **Metodologi:** probe lama menunjukkan `quotaDelta=0` saat flush tertunda; eksperimen valid bergantung pada jeda/idle check/snapshot disiplin.
- **Ekonomi:** kesalahan di sekitar transisi dapat bergeser sistematis (under/overcharge) jika dipaksakan jadi aturan.

## 8. Rekomendasi langkah berikutnya

1. **Dapatkan persetujuan eksplisit** (kuota & risiko) sebelum eksperimen apa pun ke BankAI.
2. Jika disetujui, jalankan rancangan 5.1 (3500c/4000c ×2, kontrol ketat), simpan ke file baru, lalu perbarui analisis dengan data mentah.
3. Jika transisi masih lebar, iterasi 1 titik tengah tambahan (binary search) dengan ulangan minimal, berhenti saat informasi marjinal rendah vs biaya kuota.
4. Paralel/berikutnya (terpisah): uji output > 1024 dan variasi isi untuk memutuskan apakah panjang karakter layak sebagai proksi atau perlu sumber `tokenInputBilling` lain.
5. Pertahankan `BILLING_ENABLED=false` dan `BILLING_UPSTREAM_PARITY_VERIFIED=false` sampai kriteria minimum dry-run (bagian 6) terpenuhi. Jangan tetapkan formula/koefisien final dari korelasi yang belum tervalidasi.

## Sumber data

- `/tmp/opencode/kimi-billing-exploration.json` (R1/R2, primer)
- `tmp/bankai-multiplier-measurements.json` (Kimi lama, primer)
- `tmp/upstream-billing-verify.json`, `tmp/bankai-verify.json` (konteks/cek, tidak ada Kimi tambahan)
- `tmp/bankai-base-unit-probes.json` (probe gagal, bukan bukti)
- `docs/bankai-multiplier-report.md`, `docs/billing-design.md`, `docs/billing-calibration-plan.md`

## 9. Hasil eksperimen lanjutan: 3500c dan 4000c

Tanggal pengukuran: 2026-11-17T05:25:30.806Z  
Data mentah: `/tmp/opencode/kimi-transition-followup.json`  
Eksperimen dibatasi pada empat request yang disetujui; tidak ada retry.

### 9.1 Kontrol dan snapshot

- Snapshot awal: `remainingTokens=19.978.397`, `usage.total_tokens=75.021.603`, `requests=315`.
- Idle awal stabil: `19.978.397 → 19.978.397`.
- Snapshot akhir: `remainingTokens=19.969.261`, `usage.total_tokens=75.030.739`, `requests=319`.
- Invariant `remainingTokens + usage.total_tokens = 95.000.000` berlaku pada snapshot sebelum dan sesudah setiap request, serta pada snapshot awal/akhir.
- Semua response HTTP 200; semua request `requestDelta=1`; semua `quotaDelta == dashboardDelta`; tidak ada anomali.
- Setiap request menunggu polling quota sampai counter berubah. Masing-masing memerlukan 2 polling, sekitar 1,5–1,7 detik. Tidak ada `quotaDelta=0` yang diterima sebagai hasil.
- Flags tetap `BILLING_ENABLED=false` dan `BILLING_UPSTREAM_PARITY_VERIFIED=false`.

### 9.2 Hasil per request

Base unit = `quotaDelta / multiplier` dengan multiplier Kimi 1. Input billing terinferensi = `baseUnit - 1024`, masih dekomposisi hipotesis, bukan field upstream.

| ID | Prompt chars | Prompt hash (FNV-1a 32-bit) | HTTP | `quotaDelta` | `dashboardDelta` | `prompt_tokens` | `completion_tokens` | `total_tokens` | `cached_tokens` | Base unit | Input billing terinferensi | Minimum 2048 | Konsisten |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|:---:|
| T1-3500-r1 | 3500 | `0ae1c03a` | 200 | 2201 | 2201 | 1039 | 29 | 1068 | 51 | 2201 | 1177 | tidak | ya |
| T1-3500-r2 | 3500 | `ba233681` | 200 | 2201 | 2201 | 1039 | 29 | 1068 | 51 | 2201 | 1177 | tidak | ya |
| T2-4000-r1 | 4000 | `67612107` | 200 | 2367 | 2367 | 1136 | 29 | 1165 | 51 | 2367 | 1343 | tidak | ya |
| T2-4000-r2 | 4000 | `72cc5620` | 200 | 2367 | 2367 | 1136 | 29 | 1165 | 51 | 2367 | 1343 | tidak | ya |

Hash berbeda antar pengulangan karena ID eksperimen berbeda; prefix, suffix, filler, parameter model, `max_tokens=64`, `temperature=0`, dan `stream=false` tetap sama. Perbedaan hash tidak mengubah hasil pada masing-masing titik.

Total kuota eksperimen lanjutan:

```text
2.201 + 2.201 + 2.367 + 2.367 = 9.136 kuota
```

### 9.3 Rentang transisi setelah hasil baru

Titik referensi unik sekarang:

| Prompt chars | Base unit | Input billing terinferensi | Status |
|---:|---:|---:|---|
| 3000 | 2048 | 1024* | lantai, satu pengukuran |
| 3500 | 2201 | 1177 | di atas lantai, 2/2 konsisten |
| 4000 | 2367 | 1343 | di atas lantai, 2/2 konsisten |
| 4500 | 2534 | 1510 | di atas lantai, satu pengukuran |
| 7024 | 3375 | 2351 | di atas lantai, 6/6 konsisten |

`*` Pada base 2048, nilai 1024 adalah hasil dekomposisi `base-1024`; input aktual bisa lebih rendah dan tetap menghasilkan lantai. Jangan membaca 1024 sebagai pengukuran langsung.

Kesimpulan rentang:

- 3000c masih berada pada lantai 2048.
- 3500c sudah keluar dari lantai, dengan base 2201 pada kedua ulangan.
- Maka ambang keluar lantai untuk prompt dengan karakteristik ini berada pada **(3000, 3500]**.
- Karena 3500c sudah di atas lantai, eksperimen ini menggugurkan hipotesis bahwa ambang berada di `[3500, 4500]` atau di atas 3500c.
- Data belum menentukan ambang karakter tepat; tanpa titik antara 3000 dan 3500, resolusi masih 500 karakter.

### 9.4 Pola pertumbuhan yang teramati

Input billing terinferensi naik:

- 3500c → 1177
- 4000c → 1343 (`+166` untuk `+500c`, rasio 0,332)
- 4500c → 1510 (`+167` untuk `+500c`, rasio 0,334)
- 7024c → 2351 (`+841` untuk `+2524c`, rasio ≈0,3332)

Kemiringan pasangan berturut-turut adalah 0,332; 0,334; dan sekitar 0,3332 input/karakter. Regresi linear sederhana pada empat titik di atas lantai menghasilkan kira-kira:

```text
input_terinferensi ≈ 10,51 + 0,333208 × promptChars
```

Residual maksimum pada empat titik: sekitar 0,35 unit. Ini **bukti bahwa garis tersebut cocok untuk empat titik sampel**, bukan validasi formula produksi. Koefisien ini juga tidak mengubah status koefisien 0,335 sebelumnya: 0,335 tidak digunakan sebagai formula dan belum tervalidasi secara independen terhadap variasi isi/tokenizer.

Data saat ini mendukung pola **piecewise: lantai 2048 sampai ambang, lalu pertumbuhan hampir linear pada prompt filler ini**, tetapi belum dapat membedakan linear kontinu dari tokenisasi diskret, pembulatan, atau piecewise linear pada sampel yang lebih luas.

### 9.5 Reproduksibilitas

- 3500c: base 2201, usage 1039/29/1068/51 pada 2/2 request.
- 4000c: base 2367, usage 1136/29/1165/51 pada 2/2 request.
- Delta counter dan dashboard identik pada 4/4 request.
- Hash prompt berbeda antar ulangan, tetapi setiap pasangan titik memiliki usage dan base unit identik. Ini mendukung reproduksibilitas pada struktur prompt yang diuji, bukan semua isi dengan panjang sama.

### 9.6 Rekomendasi setelah follow-up

Eksperimen berikutnya yang paling hemat untuk mempersempit ambang adalah **satu titik 3250c ×2**, dengan prompt yang sama, idle check, snapshot per request, dan polling counter yang sama. Estimasi:

- Minimum jika tetap di lantai: `2 × 2048 = 4.096` kuota.
- Batas atas berdasarkan titik terdekat yang sudah terukur (3500c): `2 × 2201 = 4.402` kuota.
- Jika 3250c tetap lantai, ambang menyempit menjadi `(3250, 3500]`.
- Jika 3250c sudah naik, ambang menyempit menjadi `(3000, 3250]`.

Satu titik 3250c lebih informatif daripada mengulang 3500/4000 sekarang, karena kedua titik baru sudah konsisten. Namun eksperimen tersebut tetap membutuhkan persetujuan eksplisit dan **belum dijalankan**.

## 10. Status kesiapan billing setelah follow-up

Hasil baru memperkuat hipotesis pola, tetapi tidak mengubah keputusan keamanan:

- Kimi **belum** memiliki formula billing produksi yang tervalidasi.
- `usage.prompt_tokens` kini menunjukkan pola yang rapi pada prompt filler, tetapi belum terbukti sebagai `tokenInputBilling` dan bukan pengganti formula runtime.
- Tabel kalibrasi masih berisiko jika digunakan untuk interpolasi atau ekstrapolasi prompt pelanggan. Panjang karakter dapat memprediksi sampel filler ini, tetapi belum terbukti stabil untuk isi, bahasa, struktur, cache, prefix sistem, atau output berbeda.
- Empat request follow-up tidak cukup untuk menyatakan Kimi siap ditagih.
- Kriteria dry-run tetap mensyaratkan input/base unit yang dapat dihitung deterministik dari data runtime, cakupan titik dan variasi isi yang memadai, ulangan, kontrol quota, serta validasi output >1024 sebelum billing diaktifkan.

Tidak ada formula final atau koefisien karakter yang ditetapkan. Flag tetap:

```env
BILLING_ENABLED=false
BILLING_UPSTREAM_PARITY_VERIFIED=false
```
