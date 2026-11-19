# BankAI Multiplier Measurement

Tanggal: 2026-11-16T22:31:39.388Z

Status: **pengukuran terkontrol selesai**. Dokumen ini memisahkan fakta, hipotesis, dan hal yang belum terverifikasi.

## Metode

- Lima model: kimi-k2.7-code, glm-5.3, deepseek-v4.1-flash, gpt-6-luna, gemini-4-argon.
- Tiga varian prompt per model: short, long_prompt, long_output.
- Dua pengulangan per varian.
- Prompt memakai instruksi output yang sama dan ID unik berdurasi tetap untuk mengurangi cache.
- Setiap request membaca quota sebelum dan sesudah request, lalu menunggu 1,5 detik.
- API Rexu dihentikan sementara. Tidak ada request Rexu selama pengukuran.
- `BILLING_ENABLED` tetap `false`.
- Data mentah: `tmp/bankai-multiplier-measurements.json`.

## Fakta

- Quota idle stabil sebelum pengukuran: `40963366` menjadi `40963366`.
- 30 request selesai dengan HTTP 200. Tidak ada request gagal.
- `quotaDelta` sama dengan `dashboardDelta` pada semua request, jadi tidak ada indikasi request lain selama pengukuran.
- Multiplier katalog diterapkan pada unit dasar, bukan pada `response.usage.total_tokens`.
- Untuk kimi-k2.7-code, glm-5.3, deepseek-v4.1-flash, dan gemini-4-argon, unit dasar konsisten:
  - short: 2048
  - long_prompt: 3375
  - long_output: 2048
- Contoh: glm-5.3 2x menghasilkan 4096 dan 6750. deepseek-v4.1-flash 2.56x menghasilkan 5243 dan 8640. gemini-4-argon 60x menghasilkan 122880 dan 202500.
- gpt-6-luna memakai unit dasar yang sama dengan `prompt_tokens + 1024`:
  - short: 5741 atau 5742
  - long_prompt: 7101 atau 7102
  - long_output: 5741 atau 5740
  - actual = 8 x unit dasar.
- Completion 29 token dan 179 token tidak menaikkan unit dasar pada model yang sama. Unit dasar long_output sama dengan short.
- Minimum 2048 terlihat pada empat model untuk prompt pendek.
- Cached token muncul antara 51 dan 1000, tetapi tidak terlihat mengurangi unit dasar.
- Reasoning token gpt-6-luna muncul 11 sampai 27, tetapi tidak menambah unit dasar di luar `prompt_tokens + 1024`.

## Anomali yang terlihat

- gemini-4-argon melaporkan `completion_tokens: 1000` dan `cached_tokens: 1000` pada semua request, termasuk saat `max_tokens: 64`. Unit dasar hanya mengikuti prompt dan blok 1024. Angka completion Gemini jangan dipakai sebagai bukti weighting output.
- gpt-6-luna melaporkan `prompt_tokens` 4717 untuk prompt 89 karakter. Ini jauh di atas model lain dan konsisten dengan adanya prompt sistem atau tokenizer yang berbeda.

## Unit dasar hasil hitung

Unit dasar = `quotaDelta / multiplierKatalog`.

| Model | Varian | Multiplier | Avg total response | Avg quota delta | Unit dasar |
|---|---|---:|---:|---:|---:|
| kimi-k2.7-code | short | 1x | 395.5 | 2048.0 | 2048.0000 |
| kimi-k2.7-code | long_prompt | 1x | 1759.5 | 3375.0 | 3375.0000 |
| kimi-k2.7-code | long_output | 1x | 547.5 | 2048.0 | 2048.0000 |
| glm-5.3 | short | 2x | 393.5 | 4096.0 | 2048.0000 |
| glm-5.3 | long_prompt | 2x | 1756.0 | 6750.0 | 3375.0000 |
| glm-5.3 | long_output | 2x | 543.5 | 4096.0 | 2048.0000 |
| deepseek-v4.1-flash | short | 2.56x | 391.5 | 5243.0 | 2048.0469 |
| deepseek-v4.1-flash | long_prompt | 2.56x | 1753.5 | 8640.0 | 3375.0000 |
| deepseek-v4.1-flash | long_output | 2.56x | 541.0 | 5243.0 | 2048.0469 |
| gpt-6-luna | short | 8x | 4760.0 | 45932.0 | 5741.5000 |
| gpt-6-luna | long_prompt | 8x | 6115.0 | 56812.0 | 7101.5000 |
| gpt-6-luna | long_output | 8x | 4865.5 | 45924.0 | 5740.5000 |
| gemini-4-argon | short | 60x | 2000.0 | 122880.0 | 2048.0000 |
| gemini-4-argon | long_prompt | 60x | 3351.0 | 202500.0 | 3375.0000 |
| gemini-4-argon | long_output | 60x | 2000.0 | 122880.0 | 2048.0000 |

## Data per request

| Model | Varian | Repeat | Prompt chars | Prompt tokens | Completion tokens | Total tokens | Cached | Reasoning | Quota delta | Dashboard delta | Katalog | Expected katalog | Actual/raw | Actual/expected |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| kimi-k2.7-code | short | 1 | 89 | 366 | 29 | 395 | 51 | 0 | 2048 | 2048 | 1x | 395 | 5.185 | 5.1848 |
| kimi-k2.7-code | long_prompt | 1 | 7024 | 1730 | 29 | 1759 | 51 | 0 | 3375 | 3375 | 1x | 1759 | 1.919 | 1.9187 |
| kimi-k2.7-code | long_output | 1 | 89 | 368 | 179 | 547 | 51 | 0 | 2048 | 2048 | 1x | 547 | 3.744 | 3.7441 |
| kimi-k2.7-code | short | 2 | 89 | 367 | 29 | 396 | 51 | 0 | 2048 | 2048 | 1x | 396 | 5.172 | 5.1717 |
| kimi-k2.7-code | long_prompt | 2 | 7024 | 1731 | 29 | 1760 | 51 | 0 | 3375 | 3375 | 1x | 1760 | 1.918 | 1.9176 |
| kimi-k2.7-code | long_output | 2 | 89 | 369 | 179 | 548 | 51 | 0 | 2048 | 2048 | 1x | 548 | 3.737 | 3.7372 |
| glm-5.3 | short | 1 | 89 | 364 | 29 | 393 | 51 | 0 | 4096 | 4096 | 2x | 786 | 10.422 | 5.2112 |
| glm-5.3 | long_prompt | 1 | 7024 | 1728 | 29 | 1757 | 51 | 0 | 6750 | 6750 | 2x | 3514 | 3.842 | 1.9209 |
| glm-5.3 | long_output | 1 | 89 | 365 | 179 | 544 | 51 | 0 | 4096 | 4096 | 2x | 1088 | 7.529 | 3.7647 |
| glm-5.3 | short | 2 | 89 | 365 | 29 | 394 | 51 | 0 | 4096 | 4096 | 2x | 788 | 10.396 | 5.198 |
| glm-5.3 | long_prompt | 2 | 7024 | 1726 | 29 | 1755 | 51 | 0 | 6750 | 6750 | 2x | 3510 | 3.846 | 1.9231 |
| glm-5.3 | long_output | 2 | 89 | 364 | 179 | 543 | 51 | 0 | 4096 | 4096 | 2x | 1086 | 7.543 | 3.7716 |
| deepseek-v4.1-flash | short | 1 | 89 | 362 | 29 | 391 | 51 | 0 | 5243 | 5243 | 2.56x | 1001 | 13.409 | 5.2378 |
| deepseek-v4.1-flash | long_prompt | 1 | 7024 | 1725 | 29 | 1754 | 51 | 0 | 8640 | 8640 | 2.56x | 4491 | 4.926 | 1.9238 |
| deepseek-v4.1-flash | long_output | 1 | 89 | 361 | 179 | 540 | 51 | 0 | 5243 | 5243 | 2.56x | 1383 | 9.709 | 3.791 |
| deepseek-v4.1-flash | short | 2 | 89 | 363 | 29 | 392 | 51 | 0 | 5243 | 5243 | 2.56x | 1004 | 13.375 | 5.2221 |
| deepseek-v4.1-flash | long_prompt | 2 | 7024 | 1724 | 29 | 1753 | 51 | 0 | 8640 | 8640 | 2.56x | 4488 | 4.929 | 1.9251 |
| deepseek-v4.1-flash | long_output | 2 | 89 | 363 | 179 | 542 | 51 | 0 | 5243 | 5243 | 2.56x | 1388 | 9.673 | 3.7774 |
| gpt-6-luna | short | 1 | 89 | 4717 | 42 | 4759 | 465 | 17 | 45928 | 45928 | 8x | 38072 | 9.651 | 1.2063 |
| gpt-6-luna | long_prompt | 1 | 7024 | 6078 | 36 | 6114 | 508 | 11 | 56816 | 56816 | 8x | 48912 | 9.293 | 1.1616 |
| gpt-6-luna | long_output | 1 | 89 | 4717 | 146 | 4863 | 476 | 21 | 45928 | 45928 | 8x | 38904 | 9.444 | 1.1805 |
| gpt-6-luna | short | 2 | 89 | 4718 | 43 | 4761 | 508 | 18 | 45936 | 45936 | 8x | 38088 | 9.648 | 1.206 |
| gpt-6-luna | long_prompt | 2 | 7024 | 6077 | 39 | 6116 | 664 | 14 | 56808 | 56808 | 8x | 48928 | 9.288 | 1.1611 |
| gpt-6-luna | long_output | 2 | 89 | 4716 | 152 | 4868 | 508 | 27 | 45920 | 45920 | 8x | 38944 | 9.433 | 1.1791 |
| gemini-4-argon | short | 1 | 89 | 1000 | 1000 | 2000 | 1000 | 0 | 122880 | 122880 | 60x | 120000 | 61.440 | 1.024 |
| gemini-4-argon | long_prompt | 1 | 7024 | 2351 | 1000 | 3351 | 1000 | 0 | 202500 | 202500 | 60x | 201060 | 60.430 | 1.0072 |
| gemini-4-argon | long_output | 1 | 89 | 1000 | 1000 | 2000 | 1000 | 0 | 122880 | 122880 | 60x | 120000 | 61.440 | 1.024 |
| gemini-4-argon | short | 2 | 89 | 1000 | 1000 | 2000 | 1000 | 0 | 122880 | 122880 | 60x | 120000 | 61.440 | 1.024 |
| gemini-4-argon | long_prompt | 2 | 7024 | 2351 | 1000 | 3351 | 1000 | 0 | 202500 | 202500 | 60x | 201060 | 60.430 | 1.0072 |
| gemini-4-argon | long_output | 2 | 89 | 1000 | 1000 | 2000 | 1000 | 0 | 122880 | 122880 | 60x | 120000 | 61.440 | 1.024 |

## Ringkasan per model dan varian

| Model | Varian | Multiplier | Avg prompt | Avg completion | Avg total | Avg actual | Avg expected | Actual/raw | Actual/expected | Konsisten |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| kimi-k2.7-code | short | 1x | 366.5 | 29.0 | 395.5 | 2048.0 | 395.5 | 5.178 | 5.1783 | ya |
| kimi-k2.7-code | long_prompt | 1x | 1730.5 | 29.0 | 1759.5 | 3375.0 | 1759.5 | 1.918 | 1.9182 | ya |
| kimi-k2.7-code | long_output | 1x | 368.5 | 179.0 | 547.5 | 2048.0 | 547.5 | 3.741 | 3.7407 | ya |
| glm-5.3 | short | 2x | 364.5 | 29.0 | 393.5 | 4096.0 | 787.0 | 10.409 | 5.2046 | ya |
| glm-5.3 | long_prompt | 2x | 1727.0 | 29.0 | 1756.0 | 6750.0 | 3512.0 | 3.844 | 1.922 | ya |
| glm-5.3 | long_output | 2x | 364.5 | 179.0 | 543.5 | 4096.0 | 1087.0 | 7.536 | 3.7681 | ya |
| deepseek-v4.1-flash | short | 2.56x | 362.5 | 29.0 | 391.5 | 5243.0 | 1002.5 | 13.392 | 5.23 | ya |
| deepseek-v4.1-flash | long_prompt | 2.56x | 1724.5 | 29.0 | 1753.5 | 8640.0 | 4489.5 | 4.927 | 1.9244 | ya |
| deepseek-v4.1-flash | long_output | 2.56x | 362.0 | 179.0 | 541.0 | 5243.0 | 1385.5 | 9.691 | 3.7842 | ya |
| gpt-6-luna | short | 8x | 4717.5 | 42.5 | 4760.0 | 45932.0 | 38080.0 | 9.650 | 1.2062 | ya |
| gpt-6-luna | long_prompt | 8x | 6077.5 | 37.5 | 6115.0 | 56812.0 | 48920.0 | 9.291 | 1.1614 | ya |
| gpt-6-luna | long_output | 8x | 4716.5 | 149.0 | 4865.5 | 45924.0 | 38924.0 | 9.439 | 1.1798 | ya |
| gemini-4-argon | short | 60x | 1000.0 | 1000.0 | 2000.0 | 122880.0 | 120000.0 | 61.440 | 1.024 | ya |
| gemini-4-argon | long_prompt | 60x | 2351.0 | 1000.0 | 3351.0 | 202500.0 | 201060.0 | 60.430 | 1.0072 | ya |
| gemini-4-argon | long_output | 60x | 1000.0 | 1000.0 | 2000.0 | 122880.0 | 120000.0 | 61.440 | 1.024 | ya |

## Hipotesis

- Kandidat formula, belum resmi:
  `unitDasar = max(2048, tokenInputBilling + 1024)`, lalu
  `quotaDelta = ceil(unitDasar * multiplierKatalog)`.
- Untuk kimi-k2.7-code, glm-5.3, deepseek-v4.1-flash, dan gemini-4-argon, `tokenInputBilling` tampak memakai hitungan yang sama untuk prompt yang sama: sekitar 1000 untuk short dan 2351 untuk long_prompt. Gemini melaporkan angka yang sama di `prompt_tokens`; tiga model lain melaporkan lebih rendah.
- Untuk gpt-6-luna, `tokenInputBilling` tampak sama dengan `prompt_tokens` yang dilaporkan, lalu ditambah 1024.
- Blok 1024 dapat berupa jatah completion, overhead sistem, atau pembulatan unit. Data belum memisahkan ketiganya.
- Completion di bawah 1024 terlihat tercakup dalam blok tersebut, karena output 179 token tidak menaikkan unit dasar.
- Cached dan reasoning token mungkin tidak dihargai terpisah, atau sudah tercakup dalam blok 1024. Data belum cukup untuk memastikan.

## Belum terverifikasi

- Formula resmi BankAI dan definisi `remainingTokens`.
- Sumber perbedaan `prompt_tokens` antara model, termasuk kemungkinan prompt sistem tersembunyi.
- Perilaku output di atas 1024 token.
- Perilaku reasoning di atas 1024 token.
- Diskon cached token.
- Urutan pembulatan dan apakah minimum 2048 berlaku sebelum atau sesudah blok 1024.
- Apakah multiplier katalog berlaku per model, per provider, atau per jenis request.
- Apakah hasil ini stabil untuk prompt yang isinya berbeda, bukan hanya panjang yang berbeda.

## Catatan probe tambahan (17 November 2026)

Probe lanjutan untuk memisahkan cache dan pertumbuhan unit dasar dijalankan sebagian lalu dihentikan. Hasilnya tidak dipakai:

- 18 request dengan prompt pendek menghasilkan `quotaDelta = 0`.
- `prompt_tokens` yang dilaporkan bervariasi acak antara 108 dan 389 untuk prompt yang hampir sama.
- Script probe sudah dihapus dari repo.

Interpretasi: pengukuran tanpa jeda cukup panjang dan tanpa variasi token yang besar tidak menghasilkan delta kuota yang bisa dibaca. Data utama di atas tetap satu-satunya bukti yang dipakai.

## Kesimpulan sementara

Multiplier katalog BankAI terbukti dipakai, tetapi bukan terhadap `prompt_tokens + completion_tokens` dari response. Untuk empat model, actual quota sama dengan multiplier katalog dikali unit dasar 2048 atau 3375. gpt-6-luna memakai unit dasar `prompt_tokens + 1024`.

Billing engine Rexu saat ini masih memakai `raw_tokens * multiplier`. Formula itu tidak cocok dengan hasil ini. Jangan aktifkan `BILLING_ENABLED` sebelum formula unit dasar dikonfirmasi dan billing engine disesuaikan.

`BILLING_ENABLED=false` dan `BILLING_UPSTREAM_PARITY_VERIFIED=false`.

