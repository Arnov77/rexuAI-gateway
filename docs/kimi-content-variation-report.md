# Laporan Perbandingan Billing Kimi — 14 Kalibrasi + 20 Variasi Isi

Tanggal: 2026-11-17

Status: **analisis saja**. Tidak ada perubahan kode/database/konfigurasi, tidak ada pengaktifan billing, tidak ada formula baru yang diterapkan. `BILLING_ENABLED=false`, `BILLING_UPSTREAM_PARITY_VERIFIED=false`.

Data mentah:
- 14 pengukuran awal: `tmp/bankai-multiplier-measurements.json`, `/tmp/opencode/kimi-billing-exploration.json`, `/tmp/opencode/kimi-transition-followup.json`.
- 8 variasi isi: `/tmp/opencode/kimi-content-variation.json`.
- 12 variasi isi lanjutan: `/tmp/opencode/kimi-content-variation-2.json` (35.636 kuota, requests 328→340).
- Gabungan metrik lokal: `/tmp/opencode/combined-metrics.json`.

`base = quotaDelta / multiplier`, `inferred_input = base − 1024`. Keduanya **inferensi**, bukan field upstream. Semua baris: HTTP 200, multiplier 1, `quotaDelta == dashboardDelta`.

---

## 1. Ringkasan eksekutif

1. **`prompt_tokens + 1024` bukan formula universal.** Persis pada **10/34** baris, gagal pada 24/34.
2. **Diskriminator empiris ditemukan: `prompt_tokens / promptChars`.** Under-count hanya pada rasio ≤ 0.334 (0.2174–0.3337); semua 10 baris persis berada di 0.3823–0.5246. Tidak ada tumpang tindih. Ambang 0.334–0.382 belum diuji. Namun rasio ini hanya bisa dihitung **setelah** `prompt_tokens` diterima, jadi bukan prediktor pra-request.
3. **Repetisi kata terbantahkan sebagai penyebab**: technical (repeat 8.9×) persis, sedangkan natural (repeat 6.5×) under-count — repetisi serupa, hasil berbeda. Rata-rata `wordRepeatFactor` persis 25.1 vs under-count 39.0.
4. **Base pada 7024c terkunci di 3375** untuk semua style: words 1726, code 3359, natural 2344, technical 2863, repeat 1527 — lima konten sangat berbeda, base identik (8 baris 7024c, termasuk 4 baris awal). Di 3500c sebaliknya base bervariasi (2201/2362/2618/2860). Pola konsisten namun **belum terjelaskan** (bukan lantai 2048).
5. **Kesimpulan**: Kimi tetap **belum dapat ditagih secara aman**. Tok/char hanya proksi, mekanisme deflasi `prompt_tokens` upstream belum diketahui, dan tanpa tokenizer upstream tagihan tak dapat direkonstruksi. Tidak ada prediktor billing deterministik dari data runtime Rexu.

---

## 2. Tabel gabungan (34 baris)

### 2.1 Eksperimen lanjutan — 12 baris (cv2)

| ID | chars | style | `prompt_tokens` | base | input terinferensi | `p+1024` | persis | tok/char | wordEnt | gap |
|---|---:|---|---:|---:|---:|---:|:--:|---:|---:|---:|
| N-3500-r1 | 3500 | natural | 1338 | 2362 | 1338 | 2362 | ✔ | 0.3823 | 7.118 | 0 |
| N-3500-r2 | 3500 | natural | 1338 | 2362 | 1338 | 2362 | ✔ | 0.3823 | 7.118 | 0 |
| P-3500-r1 | 3500 | repeat | 940 | 2201 | 1177 | 1964 | ✘ | 0.2686 | 0.292 | 237 |
| P-3500-r2 | 3500 | repeat | 940 | 2201 | 1177 | 1964 | ✘ | 0.2686 | 0.292 | 237 |
| T-3500-r1 | 3500 | technical | 1594 | 2618 | 1594 | 2618 | ✔ | 0.4554 | 6.227 | 0 |
| T-3500-r2 | 3500 | technical | 1594 | 2618 | 1594 | 2618 | ✔ | 0.4554 | 6.227 | 0 |
| N-7024-r1 | 7024 | natural | 2344 | 3375 | 2351 | 3368 | ✘ | 0.3337 | 7.089 | 7 |
| N-7024-r2 | 7024 | natural | 2344 | 3375 | 2351 | 3368 | ✘ | 0.3337 | 7.089 | 7 |
| P-7024-r1 | 7024 | repeat | 1527 | 3375 | 2351 | 2551 | ✘ | 0.2174 | 0.149 | 824 |
| P-7024-r2 | 7024 | repeat | 1527 | 3375 | 2351 | 2551 | ✘ | 0.2174 | 0.149 | 824 |
| T-7024-r1 | 7024 | technical | 2863 | 3887 | 2863 | 3887 | ✔ | 0.4076 | 6.172 | 0 |
| T-7024-r2 | 7024 | technical | 2863 | 3887 | 2863 | 3887 | ✔ | 0.4076 | 6.172 | 0 |

### 2.2 Variasi isi pertama — 8 baris (cv1)

| ID | chars | style | `prompt_tokens` | base | input terinferensi | `p+1024` | persis | tok/char | wordEnt | gap |
|---|---:|---|---:|---:|---:|---:|:--:|---:|---:|---:|
| V-3500-words-r1 | 3500 | words | 1037 | 2201 | 1177 | 2061 | ✘ | 0.2963 | 3.19 | 140 |
| V-3500-code-r1 | 3500 | code | 1836 | 2860 | 1836 | 2860 | ✔ | 0.5246 | 3.70 | 0 |
| V-3500-words-r2 | 3500 | words | 1037 | 2201 | 1177 | 2061 | ✘ | 0.2963 | 3.19 | 140 |
| V-3500-code-r2 | 3500 | code | 1836 | 2860 | 1836 | 2860 | ✔ | 0.5246 | 3.70 | 0 |
| V-7024-words-r1 | 7024 | words | 1726 | 3375 | 2351 | 2750 | ✘ | 0.2457 | 3.10 | 625 |
| V-7024-code-r1 | 7024 | code | 3359 | 4383 | 3359 | 4383 | ✔ | 0.4782 | 3.649 | 0 |
| V-7024-words-r2 | 7024 | words | 1726 | 3375 | 2351 | 2750 | ✘ | 0.2457 | 3.10 | 625 |
| V-7024-code-r2 | 7024 | code | 3359 | 4383 | 3359 | 4383 | ✔ | 0.4782 | 3.649 | 0 |

### 2.3 14 pengukuran awal (filler words, base unit model lintas)

| chars | n | `prompt_tokens` | base | input terinferensi | `p+1024` | persis | gap |
|---:|---:|---:|---:|---:|---:|:--:|---:|
| 89 | 4 | 366–369 | 2048 | 1024 | 1390–1393 | ✘ (lantai) | lantai |
| 3000 | 1 | 940 | 2048 | 1024 | 1964 | ✘ (lantai) | lantai |
| 3500 | 2 | 1039 | 2201 | 1177 | 2063 | ✘ | 138 |
| 4000 | 2 | 1136 | 2367 | 1343 | 2160 | ✘ | 207 |
| 4500 | 1 | 1232 | 2534 | 1510 | 2256 | ✘ | 278 |
| 7024 | 4 | 1726–1731 | 3375 | 2351 | 2750–2755 | ✘ | 620–625 |

Semua baris filler words (entropi kata rendah, tok/char 0.25–0.30) → **selalu under-count** di luar lantai. Konsisten dengan pola cv1 words dan cv2 repeat.

---

## 3. Analisis: apa yang membedakan persis vs under-count

Statistik kelompok (20 baris cv1+cv2, rata-rata):

| Metrik lokal | persis (10) | under-count (10) |
|---|---:|---:|
| `prompt_tokens / chars` | **0.4496** | **0.2723** |
| entropi karakter (bit) | 4.632 | 3.338 |
| entropi kata (bit) | 5.373 | 2.764 |
| rasio trigram unik | 0.1132 | 0.0418 |
| `wordRepeatFactor` | 25.1 | 39.0 |
| karakter unik | 57 | 35.4 |

**Ambang paling bersih: `prompt_tokens / chars`.**
- persis: **0.3823–0.5246** (semua 10 baris)
- under-count: **0.2174–0.3337** (semua 10 baris)
- **Tidak ada tumpang tindih**; ambang terletak di (0.334, 0.382], belum diuji.

Kasus terdekat ambang:
- **N-7024** under-count, gap hanya **7** token (tok/char 0.3337) — nyaris persis.
- **N-3500** persis pada tok/char 0.3823 (gap 0).

Perhatian penting: `prompt_tokens / chars` memerlukan `usage.prompt_tokens`, yang **hanya tersedia setelah response**. Jadi ini **diskriminator diagnostik**, bukan prediktor pra-request. Metrik lokal murni (entropi kata, trigram unik, karakter unik) berkorelasi tetapi **tumpang tindih** antar kelompok (code cv1 entropi rendah namun persis), sehingga tak dapat dipakai sendiri-sendiri sebelum request.

**Interpretasi (fakta vs hipotesis):**
- *Fakta*: under-count hanya muncul pada tok/char ≤ 0.334; gap membesar seiring tok/char menurun (0.296→140, 0.269→237, 0.246→625, 0.217→824).
- *Hipotesis*: `prompt_tokens` upstream di-deflate untuk konten sangat kompresibel (filler/repeat), sementara tagihan memakai tokenisasi asli. Mekanisme pasti (dedup, cache kompresi, tokenizer berbeda) **belum terbukti**.
- *Hipotesis*: tok/char adalah proksi; diskriminator sejati mungkin "jumlah token asli upstream", yang **tidak** tersedia di runtime Rexu.

---

## 4. Base 3375 pada 7024c — belum terjelaskan

| ID | chars | style | `prompt_tokens` | tok/char | base |
|---|---:|---|---:|---:|---:|
| P-7024 | 7024 | repeat | 1527 | 0.2174 | 3375 |
| V-7024-words | 7024 | words | 1726 | 0.2457 | 3375 |
| N-7024 | 7024 | natural | 2344 | 0.3337 | 3375 |
| V-7024-code | 7024 | code | 3359 | 0.4782 | 3375 |

Empat konten sangat berbeda (1527 / 1726 / 2344 / 3359 token terlaporkan) menghasilkan **base identik 3375** pada 7024c — 8 baris termasuk duplikat. Pada 3500c sebaliknya base **bervariasi** (2201 / 2362 / 2618 / 2860).

Ini **bukan** lantai 2048 dan bukan kelipatan rapi yang bisa dijelaskan dari `prompt_tokens`. Pola konsisten pada seluruh 8 baris 7024c, tetapi **mekanismenya tidak dapat dipastikan** dengan data sekarang. Kemungkinan: lantai kedua pada base ≈ 3375, atau kebetulan panjang 7024c memetakan ke nilai tetap. Ini bukti bahwa base **bukan** fungsi murni dari `prompt_tokens`.

---

## 5. Revisi hipotesis repetisi

- **Tertolak**: "repetisi konten menyebabkan under-count". Bukti: technical (repeat 8.9×) persis; natural (repeat 6.5×) under-count; code (repeat 36–73×) gap 0.
- **Didukung sebagian**: under-count berkorelasi dengan **rendahnya rasio token/karakter** dan **rendahnya keanekaragaman**, tetapi code membuktikan keanekaragaman karakter/simbol bisa mengkompensasi.
- **Belum teruji**: apakah gap = 0 pada code disebabkan tok/char tinggi atau mekanisme lain.

---

## 6. Apakah cukup untuk menyimpulkan prediktor billing?

**Tidak.** Yang bisa disimpulkan:

- **Ditolak tegas**: formula berbasis panjang karakter (34 baris membuktikan chars bukan penentu).
- **Ditolak**: `prompt_tokens + 1024` sebagai formula (10/34 persis, 24/34 gagal).
- **Prediktor terbaik yang tersedia**: `usage.prompt_tokens`, dengan sifat:
  - persis ketika `prompt_tokens/chars` ≥ ~0.38;
  - under-count hingga 1.48× (P-7024) ketika ≤ ~0.33;
  - under-count **sistematis** untuk konten filler/repetitif berbahasa natural.
- **Galat under-charge** memakai `max(2048, prompt+1024)`: hingga 620–824 token per request pada konten filler.

**Kandidat diskriminator lokal** (dapat dihitung Rexu dari body, bukan biaya): `prompt_tokens/chars` (butuh usage, jadi pasca-response), entropi kata, trigram unik, `wordRepeatFactor`. Semuanya berkorelasi tetapi **tidak cukup** untuk rekonstruksi tagihan — dan ambangnya belum tervalidasi.

**Informasi yang tetap hilang**: billed input tokens upstream, tokenizer/template BankAI, mekanisme deflasi `prompt_tokens`, lantai non-2048 (3375), bobot cache/reasoning, atribusi kuota per request.

---

## 7. Langkah lanjut paling informatif (menunggu arahan)

Prioritas berdasarkan nilai informasi per kuota:

1. **Peta lantai 3375** — 2–3 request di 7024c dengan tok/char menengah untuk menguji apakah 3375 lantai sungguhan (menjelaskan anomali §4).
2. **Ambang tok/char** — 4–6 request dengan rasio 0.30–0.38 untuk mempersempit ambang under-count.
3. **Kontrol style persis lintas panjang** — 2 request teknis di panjang baru (mis. 2000c) untuk menguji apakah "persis" bertahan di bawah lantai 2048.

**Estimasi kuota**: #1 ≈ 10.000, #2 ≈ 18.000, #3 ≈ 8.000. Semua opsional; **tidak ada request dijalankan tanpa persetujuan.**

---

## 8. Batasan

- Tidak ada request sejak `kimi-content-variation-2.json` (12 request, 35.636 kuota).
- Tidak ada perubahan kode/database/konfigurasi/dokumentasi proyek selain dokumen analisis ini.
- Flag tetap `BILLING_ENABLED=false`, `BILLING_UPSTREAM_PARITY_VERIFIED=false`.
- Tidak ada formula baru dibuat atau diterapkan.

---

## Referensi

- `/tmp/opencode/kimi-content-variation-2.json` — 12 request lanjutan (raw).
- `/tmp/opencode/kimi-content-variation.json` — 8 request variasi isi (raw).
- `/tmp/opencode/combined-metrics.json` — gabungan 20 baris + metrik lokal.
- `/tmp/opencode/cv2-prompt-design.json` — prompt rancangan lanjutan.
- `tmp/bankai-multiplier-measurements.json`, `/tmp/opencode/kimi-billing-exploration.json`, `/tmp/opencode/kimi-transition-followup.json` — 14 pengukuran awal.
- `docs/kimi-runtime-billing-audit.md` — audit runtime.
- `docs/kimi-undercount-investigation.md` — rancangan eksperimen lanjutan.