# Panduan Deploy Rexu

Dokumen ini menjelaskan cara men-deploy Rexu dari nol di VPS Linux: mulai dari instalasi dependensi, konfigurasi environment, migrasi database, build, PM2, nginx/Caddy, sampai verifikasi dan perawatan.

Dokumen ini ditulis untuk Ubuntu 22.04/24.04 dan diasumsikan semua perintah dijalankan sebagai `root` atau user dengan akses `sudo`. Ganti placeholder seperti `rexu.ai.id`, `/root/rexu-ai-gateway`, dan `sk-...` dengan nilai Anda.

> **Konsep deploy:** frontend Rexu adalah **static files** yang disajikan nginx/Caddy dari `/var/www/rexu/web`. Backend adalah proses Node.js yang dijalankan PM2 dengan nama `rexu-api` di port `3001`. Database PostgreSQL berada di luar VPS (Aiven/Neon/Supabase).

---

## 1. Prasyarat

### 1.1 Spesifikasi minimum

| Komponen | Rekomendasi | Keterangan |
|---|---|---|
| OS | Ubuntu 22.04 LTS / 24.04 LTS | Perintah di dokumen ini memakai `apt` |
| CPU/RAM | 1 vCPU / 1 GB RAM | API dijalankan dengan `--max-old-space-size=256` |
| Node.js | 22.x | Wajib; project memakai target `node22` |
| npm | 10.x atau lebih baru | Ikut terpasang bersama Node.js 22 |
| PostgreSQL | Eksternal (Aiven/Neon/Supabase) | Tidak dijalankan di VPS |
| PM2 | Versi stabil terbaru | Process manager untuk API |
| Web server | nginx **atau** Caddy | Pilih salah satu, jangan keduanya |
| Domain | Sudah pointing ke IP VPS | A record `rexu.ai.id` dan `www.rexu.ai.id` |
| SSL | Let's Encrypt | Otomatis lewat certbot (nginx) atau Caddy |

### 1.2 Mengapa PostgreSQL eksternal?

VPS hanya menjalankan API dan web server. Menaruh PostgreSQL di VPS yang sama akan memakan RAM dan disk, menambah beban backup, dan memperbesar risiko kehilangan data saat VPS bermasalah. Layanan terkelola seperti Aiven, Neon, atau Supabase menangani backup, patching, dan ketersediaan database. Rexu terhubung lewat `DATABASE_URL` (pooled) dan `DATABASE_URL_DIRECT` (koneksi langsung untuk migrasi).

### 1.3 Update sistem dan paket dasar

```bash
# Update daftar paket dan paket sistem
sudo apt update
sudo apt upgrade -y

# Paket dasar yang dibutuhkan
sudo apt install -y curl git build-essential ca-certificates gnupg ufw rsync lsof dnsutils openssl
```

### 1.4 Install Node.js 22

```bash
# Tambahkan repository NodeSource untuk Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

# Install Node.js (npm ikut terpasang)
sudo apt install -y nodejs

# Verifikasi versi
node -v   # harus v22.x.x
npm -v    # minimal 10.x
```

### 1.5 Install PM2

```bash
# PM2 dipasang global agar bisa dipakai dari direktori mana pun
sudo npm install -g pm2

# Verifikasi
pm2 -v
```

### 1.6 Install nginx (jika memakai nginx)

```bash
sudo apt install -y nginx

# Pastikan nginx aktif dan otomatis start saat boot
sudo systemctl enable nginx
sudo systemctl start nginx
```

Jika Anda memilih Caddy, **jangan** install nginx. Lihat bagian 9b.

### 1.7 Siapkan web root

```bash
# Direktori tempat file hasil build frontend akan disalin
sudo mkdir -p /var/www/rexu/web

# Beri akses baca ke web server
sudo chown -R www-data:www-data /var/www/rexu/web
```

### 1.8 Firewall dan port

| Port | Akses | Kegunaan |
|---|---|---|
| 22 | Publik (batasi jika perlu) | SSH |
| 80 | Publik | HTTP, redirect ke HTTPS, verifikasi SSL |
| 443 | Publik | HTTPS |
| 3001 | **Internal saja** | API Node.js (`127.0.0.1:3001`) |

```bash
# Izinkan SSH agar tidak terkunci
sudo ufw allow OpenSSH

# Izinkan HTTP dan HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# JANGAN membuka 3001 ke publik. API hanya diakses lewat reverse proxy.
# Jika terlanjur dibuka: sudo ufw delete allow 3001/tcp

sudo ufw enable
sudo ufw status
```

### 1.9 Siapkan CA certificate database (khusus Aiven)

Aiven umumnya meminta CA certificate. Unduh `ca.pem` dari dashboard Aiven, lalu simpan di server.

⚠️ Jalankan `mkdir` di bawah **setelah** repository di-clone pada bagian 3. `git clone` membutuhkan direktori tujuan yang belum ada.

```bash
# Buat direktori cert di dalam project (setelah clone)
mkdir -p /root/rexu-ai-gateway/cert

# Salin file ca.pem ke lokasi ini (misalnya lewat scp)
# scp ca.pem root@IP_VPS:/root/rexu-ai-gateway/cert/ca.pem
```

Path absolut file ini nanti diisi ke `DATABASE_CA_PATH`, misalnya `/root/rexu-ai-gateway/cert/ca.pem`.

✅ Prasyarat selesai jika `node -v` menampilkan v22, `pm2 -v` berjalan, web server terpasang, dan domain sudah mengarah ke VPS.

---

## 2. Struktur Project

```text
rexu-ai-gateway/
├── apps/
│   ├── api/                  # Backend Fastify 5 (TypeScript)
│   │   ├── src/
│   │   │   ├── config/       # Validasi environment (env.ts)
│   │   │   ├── modules/      # Billing, chat, models
│   │   │   ├── routes/       # auth, user, admin, v1
│   │   │   └── server.ts     # Entry point API
│   │   ├── dist/             # Hasil build API (dibuat saat build)
│   │   └── package.json
│   └── web/                  # Frontend React 19 + Vite + Tailwind 4
│       ├── src/
│       ├── dist/             # Static files hasil build (dibuat saat build)
│       └── package.json
├── packages/
│   ├── db/                   # Drizzle schema, migration SQL, seed, koneksi DB
│   │   ├── drizzle/          # File migration 0000–0005
│   │   └── src/
│   └── shared/               # Tipe, schema Zod, konstanta bersama
├── scripts/                  # Script utilitas (migrasi, verifikasi, billing)
├── infra/                    # ecosystem.config.cjs, nginx.conf.example, Caddyfile.example
├── docs/                     # Dokumentasi internal (desain billing, dll.)
├── .env.example              # Contoh environment
└── package.json              # npm workspaces + script root
```

Penjelasan singkat:

- **`apps/api`** — Fastify backend. Menangani autentikasi session, API key, proxy chat ke BankAI, billing, dan endpoint admin. Di-build dengan `tsup` menjadi `dist/server.js`.
- **`apps/web`** — React SPA. Di-build dengan Vite menjadi file statis di `apps/web/dist`. Tidak dijalankan sebagai server Node.js di produksi.
- **`packages/db`** — Schema Drizzle, koneksi PostgreSQL, migration SQL, dan seed system settings.
- **`packages/shared`** — Tipe dan schema yang dipakai API maupun web.
- **`scripts/`** — Perintah operasional: seed admin, verifikasi BankAI, verifikasi billing, kalibrasi, rekonsiliasi.
- **`infra/`** — Konfigurasi proses (PM2) dan reverse proxy (nginx/Caddy).

---

## 3. Clone & Install

```bash
# Masuk ke direktori kerja
cd /root

# Clone repository (ganti URL dengan repository Anda)
git clone https://github.com/USERNAME/rexu-ai-gateway.git rexu-ai-gateway

# Masuk ke project
cd rexu-ai-gateway

# Install semua dependency workspace (root, apps/api, apps/web, packages/*)
npm install

# Salin contoh environment
cp .env.example .env

# Batasi akses file berisi secret
chmod 600 .env
```

⚠️ `.env`, `cert/`, `tmp/`, dan file key **tidak boleh** masuk repository. Pastikan `.gitignore` sudah mengabaikannya.

⚠️ Jangan memakai `npm install --omit=dev`. Build membutuhkan `devDependencies` (tsup, vite, typescript, drizzle-kit).

Isi `.env` pada langkah berikutnya sebelum menjalankan migrasi.

---

## 4. Environment Variables

File `.env` dibaca otomatis oleh `packages/db/src/env.ts` melalui `dotenv`. Lokasi yang dicari, berurutan:

1. `apps/api/.env` (saat proses berjalan dengan cwd `apps/api`)
2. `.env` di root project

Karena PM2 menjalankan proses dengan `cwd = apps/api`, cara paling aman adalah menaruh satu `.env` di **root project** (`/root/rexu-ai-gateway/.env`).

> `dotenv` **tidak menimpa** environment variable yang sudah ada di proses. Artinya, jika shell Anda mengekspor `BANKAI_API_KEY` lama, nilai itulah yang dipakai dan `.env` diabaikan. Ini penyebab umum respons berupa kutipan motivasi. Lihat peringatan di bagian 8.

### 4.1 Database

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `DATABASE_URL` | Ya | — | Connection string PostgreSQL untuk runtime API. Gunakan endpoint **pooled** jika tersedia. Contoh: `postgres://user:pass@host:port/db?sslmode=require`. Parameter `sslmode`/`sslrootcert` di URL dihapus otomatis; TLS diatur lewat `DATABASE_CA_PATH`. |
| `DATABASE_URL_DIRECT` | Ya | `DATABASE_URL` | Connection string **langsung** (tanpa pooler) untuk migrasi. `npm run db:migrate` memakai ini lebih dulu, lalu fallback ke `DATABASE_URL`. |
| `DATABASE_CA_PATH` | Ya untuk Aiven | — | Path absolut ke `ca.pem` (boleh file, boleh direktori yang berisi `ca.pem`). Jika diisi, koneksi memakai CA tersebut dengan `rejectUnauthorized: true`. Tanpa ini, koneksi tidak memakai TLS dan Aiven akan menolak. |

### 4.2 Session & Security

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `SESSION_SECRET` | Ya | — | Minimal **32 karakter**. Kunci HMAC-SHA256 untuk hash token session. Mengubah nilai ini membuat semua session lama tidak valid. |
| `API_KEY_PEPPER` | Ya | — | Minimal **32 karakter**. Pepper HMAC-SHA256 untuk hash API key `sk-rxu-...`. **Jangan diubah setelah ada API key dibuat**, karena semua key lama tidak akan cocok lagi. |

Generate nilai acak:

```bash
# Jalankan dua kali, gunakan hasil berbeda untuk masing-masing variable
openssl rand -hex 32
```

### 4.3 Upstream BankAI

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `BANKAI_API_KEY` | Ya | — | API key milik pemilik Rexu. Hanya dipakai backend, tidak pernah dikirim ke browser. |
| `BANKAI_BASE_URL` | Tidak | `https://bankai.web.id/api` | Base URL upstream. Trailing slash dihapus otomatis. |
| `BANKAI_AUTH_HEADER` | Tidak | `authorization` | Nama header autentikasi ke BankAI. |
| `BANKAI_AUTH_SCHEME` | Tidak | `Bearer` | Skema autentikasi, digabung menjadi `Bearer <key>`. |
| `BANKAI_CHAT_PATH` | Tidak | `/chat/completions` | Path chat completions. |
| `BANKAI_MODELS_PATH` | Tidak | `/v1/models` | Path daftar model. |
| `BANKAI_QUOTA_PATH` | Tidak | `/v1/quota` | Path kuota upstream. |
| `BANKAI_STREAM_USAGE` | Tidak | `true` | String `true`/`false`. Meminta `stream_options.include_usage` saat streaming. |
| `BANKAI_TIMEOUT_MS` | Tidak | `120000` | Timeout request non-streaming (ms). |
| `BANKAI_STREAM_TIMEOUT_MS` | Tidak | `300000` | Timeout request streaming (ms). |

### 4.4 Billing

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `BILLING_ENABLED` | Tidak | `false` | String `true`/`false`. Jika `true`, request chat wajib melewati reserve → settle. |
| `BILLING_UPSTREAM_PARITY_VERIFIED` | Tidak | `false` | **Wajib `true` jika `BILLING_ENABLED=true`.** Bila tidak, API menolak boot dengan error `BILLING_ENABLED requires BILLING_UPSTREAM_PARITY_VERIFIED=true`. |
| `BILLING_RESERVATION_TTL_MS` | Tidak | `600000` | Umur reservasi sebelum dianggap kedaluwarsa (10 menit). |
| `BILLING_MAX_RESERVE` | Tidak | `1000000` | Batas maksimum RC yang boleh direservasi untuk satu request. |
| `BILLING_DEFAULT_RESERVE` | Tidak | — | **Bukan environment variable di codebase ini.** Nilai default completion reserve disimpan sebagai system setting `billing_default_reserve` (di-seed `8192`). Lihat catatan di bagian 4.8. |

### 4.4b Midtrans QRIS

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `MIDTRANS_SERVER_KEY` | Ya | — | Server Key dari dashboard Midtrans. Dipakai untuk Basic Auth ke Core API dan verifikasi signature webhook. Jangan pernah dikirim ke browser. |
| `MIDTRANS_CLIENT_KEY` | Ya | — | Client Key dari dashboard Midtrans. Disimpan untuk kebutuhan konfigurasi frontend/Midtrans Snap di masa depan. |
| `MIDTRANS_ENV` | Tidak | `sandbox` | `sandbox` memakai `https://api.sandbox.midtrans.com`, `production` memakai `https://api.midtrans.com`. |

### 4.4c Skymail (Email OTP)

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `SKYMAIL_API_URL` | Ya | — | Endpoint kirim email Skymail. Contoh: `https://skymail.ink/api/email/send`. |
| `SKYMAIL_TOKEN` | Ya | — | Token API Skymail. Hanya dipakai backend, jangan dikirim ke browser. |
| `SKYMAIL_ACCOUNT_ID` | Ya | — | ID akun pengirim di Skymail (angka). |
| `SKYMAIL_SENDER_NAME` | Tidak | `Rexu` | Nama pengirim yang tampil di inbox penerima. |
| `SKYMAIL_SENDER_FROM` | Ya | — | Alamat email pengirim, misalnya `noreply@rexu.ai.id`. Domain pengirim harus sudah diverifikasi di Skymail. |

Email dipakai untuk mengirim OTP registrasi. Detail setup ada di bagian **12c. Setup Email**.

### 4.5 Admin

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `ADMIN_EMAIL` | Tidak | `admin@rexu.local` | Dibaca **hanya** oleh `scripts/seed-admin.ts`. |
| `ADMIN_PASSWORD` | Tidak | — | Dibaca **hanya** oleh `scripts/seed-admin.ts`. Jika kosong atau kurang dari 12 karakter, password dibuat acak dan dicetak sekali ke terminal. |
| `REGISTRATION_MODE` | Tidak | `closed` | Dibaca **hanya** oleh `npm run db:seed`. Nilai `public` membuka registrasi publik; nilai lain menjadi `closed`. |

### 4.6 Telegram Monitor (opsional)

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Tidak | — | Token bot dari @BotFather. Monitor hanya aktif jika token dan chat ID terisi. |
| `TELEGRAM_CHAT_ID` | Tidak | — | ID chat/grup tujuan notifikasi. |
| `TELEGRAM_THREAD_ID` | Tidak | — | Opsional, `message_thread_id` untuk forum group/supergroup. |
| `MONITOR_QUOTA_INTERVAL_MS` | Tidak | `900000` | Interval cek kuota BankAI (15 menit). |
| `MONITOR_UPSTREAM_INTERVAL_MS` | Tidak | `1800000` | Interval cek kesehatan upstream (30 menit). |
| `MONITOR_RECONCILE_INTERVAL_MS` | Tidak | `3600000` | Interval cek request pending rekonsiliasi (1 jam). |
| `MONITOR_QUOTA_WARN_PCT` | Tidak | `80` | Ambang peringatan pemakaian kuota (%). |
| `MONITOR_QUOTA_CRITICAL_PCT` | Tidak | `90` | Ambang kritis pemakaian kuota (%). |
| `MONITOR_RECONCILE_PENDING_HOURS` | Tidak | `6` | Kirim notifikasi jika ada request `reconciliation` lebih lama dari X jam. |

Monitor memakai Telegram Bot API Rich Message (`sendRichMessage`). Notifikasi dikirim hanya saat status berubah (kuota warning → critical, upstream down/degraded → recovered, atau pending rekonsiliasi baru), sehingga tidak spam. Jika `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` kosong, cron tidak dijalankan.

### 4.7 Server

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `PORT` | Tidak | `3001` | Port API. Nilai ini juga di-set PM2 lewat `ecosystem.config.cjs`. |
| `HOST` | Tidak | — | **Tidak dibaca oleh codebase.** `apps/api/src/server.ts` selalu listen di `0.0.0.0`. |
| `LOG_LEVEL` | Tidak | `info` | Level log Fastify: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |
| `NODE_ENV` | Tidak | `development` | Set `production` di server. PM2 sudah mengeset ini. |
| `APP_URL` | Ya (produksi) | `http://localhost:5173` | Origin utama yang diizinkan CORS. **Wajib** diisi URL publik, misalnya `https://rexu.ai.id`. Jika salah, browser akan diblokir CORS. |
| `TRUSTED_ORIGINS` | Tidak | `""` | Origin tambahan, dipisahkan koma, harus menyertakan skema. Contoh: `https://rexu.ai.id,http://10.0.0.5:21072`. |
| `TRUST_PROXY` | Tidak | `1` | Jumlah hop proxy yang dipercaya. `1` = tepat satu hop (nginx langsung), `0` = tidak percaya proxy. Jangan isi `true`/`false`; schema env memvalidasi angka. PM2 sudah mengeset `1`. |

### 4.8 Variable yang tidak dibaca codebase

Bagian ini penting agar tidak ada salah paham. Variable berikut **tidak dibaca** oleh kode saat ini:

| Variable | Status di codebase |
|---|---|
| `HOST` | Tidak ada. Server selalu listen di `127.0.0.1` (loopback); trafik publik wajib lewat nginx. |
| `BILLING_DEFAULT_RESERVE` | Tidak ada sebagai env. Nilai efektifnya adalah system setting `billing_default_reserve` (seed `8192`). Ubah lewat seed/DB, bukan `.env`. |

### 4.9 Environment khusus script verifikasi

Variable berikut tidak divalidasi oleh `env.ts`, tetapi dibaca oleh script di `scripts/`. Tidak perlu diisi di `.env` produksi kecuali Anda menjalankan verifikasi.

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `TEST_API_KEY` | Ya untuk `verify:billing` dan `calibrate:min-block` | — | API key `sk-rxu-...` milik user uji. Script memakainya untuk memanggil `/v1/chat/completions`. |
| `API_BASE_URL` | Tidak | `http://localhost:3001` | Base URL Rexu untuk script verifikasi/kalibrasi. |
| `REXU_BASE_URL` | Tidak | `http://localhost:3001` | Alternatif `API_BASE_URL`; dipakai jika `API_BASE_URL` kosong. |
| `ALLOW_BILLING_TESTS` | Ya untuk `test:billing`, `test:upstream-billing`, `measure:upstream` | — | Harus `true`. Script menolak berjalan jika `NODE_ENV=production`. |
| `BANKAI_TEST_MODEL` | Tidak | — | Model yang dipakai `verify:bankai` untuk uji chat. Jika kosong, script memilih model yang tersedia. |

⚠️ `test:billing`, `test:upstream-billing`, dan `measure:upstream` membuat/menghapus data uji di database. Jalankan hanya di database development/staging, bukan produksi.

### 4.10 Contoh `.env` lengkap

```dotenv
# ============================================================
# Runtime
# ============================================================
NODE_ENV=production
PORT=3001
APP_URL=https://rexu.ai.id
LOG_LEVEL=info
TRUST_PROXY=1
TRUSTED_ORIGINS=https://rexu.ai.id

# ============================================================
# Database (PostgreSQL eksternal)
# ============================================================
DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
DATABASE_URL_DIRECT=postgres://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
DATABASE_CA_PATH=/root/rexu-ai-gateway/cert/ca.pem

# ============================================================
# Session & Security
# Hasil dari: openssl rand -hex 32
# ============================================================
SESSION_SECRET=GANTI_DENGAN_64_KARAKTER_HEX_ACAK
API_KEY_PEPPER=GANTI_DENGAN_64_KARAKTER_HEX_ACAK_LAIN

# ============================================================
# Upstream BankAI
# ============================================================
BANKAI_BASE_URL=https://bankai.web.id/api
BANKAI_API_KEY=sk-bankai-GANTI_DENGAN_KEY_ASLI
BANKAI_AUTH_HEADER=authorization
BANKAI_AUTH_SCHEME=Bearer
BANKAI_CHAT_PATH=/chat/completions
BANKAI_MODELS_PATH=/v1/models
BANKAI_QUOTA_PATH=/v1/quota
BANKAI_STREAM_USAGE=true
BANKAI_TIMEOUT_MS=120000
BANKAI_STREAM_TIMEOUT_MS=300000

# ============================================================
# Billing
# Jangan aktifkan sebelum prasyarat bagian 12 terpenuhi.
# ============================================================
BILLING_ENABLED=false
BILLING_UPSTREAM_PARITY_VERIFIED=false
BILLING_RESERVATION_TTL_MS=600000
BILLING_MAX_RESERVE=1000000

# ============================================================
# Midtrans QRIS
# Sandbox untuk testing, production saat siap menerima uang.
# ============================================================
MIDTRANS_SERVER_KEY=GANTI_DENGAN_SERVER_KEY_MIDTRANS
MIDTRANS_CLIENT_KEY=GANTI_DENGAN_CLIENT_KEY_MIDTRANS
MIDTRANS_ENV=sandbox

# ============================================================
# Skymail (email OTP registrasi)
# Domain pengirim harus sudah diverifikasi di Skymail.
# ============================================================
SKYMAIL_API_URL=https://skymail.ink/api/email/send
SKYMAIL_TOKEN=GANTI_DENGAN_TOKEN_SKYMAIL
SKYMAIL_ACCOUNT_ID=1
SKYMAIL_SENDER_NAME=Rexu
SKYMAIL_SENDER_FROM=noreply@rexu.ai.id

# ============================================================
# Admin (dipakai oleh npm run seed:admin)
# ============================================================
ADMIN_EMAIL=admin@rexu.local
ADMIN_PASSWORD=GANTI_DENGAN_PASSWORD_MINIMAL_12_KARAKTER

# ============================================================
# Registrasi (dipakai oleh npm run db:seed)
# ============================================================
REGISTRATION_MODE=closed

# ============================================================
# Telegram Monitor (opsional)
# Kosongkan token/chat ID untuk menonaktifkan cron monitor.
# ============================================================
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
# Opsional, hanya untuk forum group/supergroup.
TELEGRAM_THREAD_ID=

# Interval monitor (ms)
MONITOR_QUOTA_INTERVAL_MS=900000
MONITOR_UPSTREAM_INTERVAL_MS=1800000
MONITOR_RECONCILE_INTERVAL_MS=3600000

# Ambang batas monitor
MONITOR_QUOTA_WARN_PCT=80
MONITOR_QUOTA_CRITICAL_PCT=90
MONITOR_RECONCILE_PENDING_HOURS=6
```

⚠️ `APP_URL` harus persis sama dengan origin yang dibuka di browser (skema + domain + port bila ada). `http://` vs `https://` dianggap origin berbeda.

---

## 5. Database Setup

Jalankan semua perintah dari **root project**.

```bash
# 1. Terapkan semua migration ke database
npm run db:migrate

# 2. Seed system settings awal
npm run db:seed

# 3. Buat/update akun admin
npm run seed:admin

# 4. Verifikasi koneksi dan autentikasi ke BankAI
npm run verify:bankai
```

### 5.1 Apa yang dilakukan setiap command?

**`npm run db:migrate`**

Menjalankan `packages/db/src/migrate.ts` yang memakai Drizzle migrator. Koneksi memakai `DATABASE_URL_DIRECT` (fallback `DATABASE_URL`). Semua file SQL di `packages/db/drizzle/` diterapkan berurutan dan dicatat di tabel migration Drizzle, sehingga aman dijalankan berulang.

| Migration | Isi |
|---|---|
| `0000_init.sql` | Tabel inti: users, sessions, api_keys, wallets, models, conversations, messages, orders, token_packages, transactions, quota_adjustments, usage_logs, audit_logs, system_settings, payment_webhook_events, beserta enum, foreign key, dan index. |
| `0001_billing_skipped.sql` | Menambah status billing `skipped`. |
| `0002_billing_reservations.sql` | Menambah status `reserved`, kolom `reserved_at`, `reservation_expires_at`, dan index kedaluwarsa. |
| `0003_bankai_multiplier.sql` | Menambah `bankai_multiplier_bp` pada models/usage_logs, mengisi multiplier awal, dan menonaktifkan model `-FREE`. |
| `0004_credits.sql` | Rename satuan token menjadi credit (RC): `total_credits`, `used_credits`, `reserved_credits`, `tokens_billed`, `credits_deducted`, dll. |
| `0005_min_billing.sql` | Menambah `effective_min_block` dan `min_block_override`, plus override `45680` untuk `gpt-6-luna` dan `gpt-6-astra`. |
| `0006_packages.sql` | Seed 6 paket RC (`token_packages`): Starter, Basic, Standard, Plus, Pro, Scale. Idempoten lewat `ON CONFLICT (slug) DO NOTHING`. |

⚠️ **Jalankan `npm run db:migrate` setiap deploy** jika ada file migration baru. Migration yang sudah pernah diterapkan akan dilewati.

**`npm run db:seed`**

Meng-upsert 6 system setting: `registration_mode`, `billing_enabled`, `billing_default_reserve` (`8192`), `billing_max_reserve` (`32768`), `public_model_multipliers`, dan `maintenance_mode`. Aman dijalankan berulang.

> Catatan: `billing_default_reserve` **dipakai** runtime sebagai default completion reserve (dapat diubah di tabel `system_settings`). Sebaliknya, `billing_max_reserve` di system settings hanya informasi; batas reservasi yang benar-benar dipakai berasal dari env `BILLING_MAX_RESERVE`.

**`npm run seed:admin`**

Membuat user admin jika belum ada, atau memperbarui user dengan email yang sama menjadi `role=admin`, `status=active`, dan mengganti password. Wallet user juga dibuat jika belum ada. Jika `ADMIN_PASSWORD` kosong atau kurang dari 12 karakter, password acak dibuat dan **dicetak sekali** ke terminal:

```text
ADMIN_PASSWORD (generated, keep safe): xxxxxxxxxxxxxxxxxxxxxxxx
```

Catat password tersebut. Simpan di password manager.

**`npm run verify:bankai`**

Memeriksa koneksi ke BankAI: daftar model, chat completion, dan quota. Laporan tanpa secret ditulis ke `tmp/bankai-verify.json`. Perintah ini membutuhkan `BANKAI_API_KEY` yang valid.

### 5.2 Setelah migrasi: sinkronisasi model

Seed **tidak** mengisi katalog model. Setelah login sebagai admin:

1. Buka **Admin → Models**.
2. Klik **Sinkronisasi** untuk memanggil `POST /api/admin/models/sync`.
3. Model baru masuk dengan status **nonaktif** dan multiplier kosong.
4. Isi multiplier desimal (mis. `2.56` berarti 2,56x; `1` berarti 1x) lalu aktifkan model yang ingin dijual.
5. Tambahkan saldo RC ke user lewat **Admin → Users → Tambah / Kurangi RC**.

Tanpa langkah ini, `/v1/models` akan kosong dan Playground tidak bisa dipakai.

✅ Database siap jika `npm run verify:bankai` selesai tanpa error dan admin bisa login.

---

## 6. Build

```bash
# Build backend: tsup → apps/api/dist/server.js
npm run build -w @rexu/api

# Build frontend: vite → apps/web/dist (HTML, JS, CSS, assets)
npm run build -w @rexu/web

# Opsional tetapi disarankan sebelum build
npm run typecheck
npm run lint
```

Hasil build:

```text
apps/api/dist/server.js          # entry point PM2
apps/web/dist/index.html         # entry point static web
apps/web/dist/assets/*           # bundle ber-hash
```

⚠️ Build frontend **tidak** membutuhkan `.env`; konfigurasi runtime API dibaca saat proses start. Build backend juga tidak menghubungi database.

---

## 7. Deploy Web (Static Files)

Frontend adalah SPA statis. nginx/Caddy menyajikan file dari `/var/www/rexu/web`; tidak ada proses Node.js untuk frontend.

```bash
# Pastikan direktori tujuan ada
sudo mkdir -p /var/www/rexu/web

# Salin hasil build. --delete menghapus asset lama yang sudah tidak dipakai.
sudo rsync -a --delete apps/web/dist/ /var/www/rexu/web/

# Pastikan web server bisa membaca file
sudo chown -R www-data:www-data /var/www/rexu/web

# Verifikasi
ls -la /var/www/rexu/web
```

Alternatif tanpa rsync:

```bash
# Hapus isi lama lalu salin ulang
sudo rm -rf /var/www/rexu/web/*
sudo cp -r apps/web/dist/* /var/www/rexu/web/
sudo chown -R www-data:www-data /var/www/rexu/web
```

Penjelasan:

- `index.html` **tidak** di-cache lama oleh konfigurasi nginx contoh, sedangkan file di `/assets/` di-cache `immutable` selama 1 tahun karena namanya ber-hash. Setiap build menghasilkan nama file baru.
- Gunakan `--delete` agar bundle lama tidak menumpuk dan membingungkan saat troubleshooting.
- Jangan mengarahkan `root` nginx ke `apps/web/dist` di dalam repo. Gunakan `/var/www/rexu/web` agar deploy tidak bergantung pada lokasi repo.

---

## 8. PM2 Setup

Isi `infra/ecosystem.config.cjs`:

```javascript
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'rexu-api',
      cwd: path.resolve(__dirname, '../apps/api'),
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
        TRUST_PROXY: '1',
      },
    },
  ],
};
```

Penjelasan:

- `name: 'rexu-api'` — nama proses yang dipakai semua perintah PM2.
- `cwd` — proses berjalan di `apps/api`, sehingga `.env` dicari di `apps/api/.env` lalu root project.
- `script: 'dist/server.js'` — **wajib build API terlebih dahulu** (`npm run build -w @rexu/api`).
- `instances: 1`, `exec_mode: 'fork'` — satu proses; jangan memakai cluster mode karena state rate limit dan cache proses tidak dibagi.
- `max_memory_restart: '400M'` dan `--max-old-space-size=256` — menjaga pemakaian RAM VPS kecil.
- `env` — nilai ini masuk ke `process.env` dan **menang** atas `.env` karena `dotenv` tidak menimpa variable yang sudah ada.

### 8.1 Start pertama kali

```bash
# Dari root project
pm2 start infra/ecosystem.config.cjs

# Simpan daftar proses agar dipulihkan setelah reboot
pm2 save

# Generate startup script. Jalankan perintah `sudo ...` yang dicetak PM2.
pm2 startup
```

### 8.2 Perintah harian

```bash
# Status semua proses
pm2 status

# Log real-time
pm2 logs rexu-api

# 50 baris log terakhir
pm2 logs rexu-api --lines 50

# Detail proses (cwd, script, env)
pm2 describe rexu-api

# Restart setelah build/perubahan .env
pm2 restart rexu-api

# Stop dan hapus dari daftar PM2
pm2 stop rexu-api
pm2 delete rexu-api
```

### 8.3 ⚠️ Peringatan: `pm2 restart --update-env`

**JANGAN** menjalankan `pm2 restart rexu-api --update-env` jika di shell Anda ada `BANKAI_API_KEY` (termasuk key lama dari sesi sebelumnya).

`--update-env` menyalin environment shell ke proses PM2. Karena `dotenv` tidak menimpa variable yang sudah ada, key lama di shell akan **mengalahkan** nilai benar di `.env`. Gejalanya: API mengembalikan kutipan motivasi, bukan jawaban model.

Gunakan salah satu dari:

```bash
# Aman: restart tanpa menyalin environment shell
pm2 restart rexu-api

# Aman: buang BANKAI_API_KEY dari environment perintah ini saja
env -u BANKAI_API_KEY pm2 restart rexu-api --update-env
```

Cek key yang benar-benar dipakai proses (tanpa menampilkan nilainya):

```bash
# Panjang karakter key yang terlihat oleh proses (harus sama dengan key asli).
# Perintah ini hanya mencetak panjangnya, bukan nilai key.
pm2 env $(pm2 id rexu-api | tr -d '[] ') \
  | awk -F': ' '/^BANKAI_API_KEY:/ { print length($2) }'
```

Jika Anda sengaja mengubah `.env`, cukup `pm2 restart rexu-api` — proses baru akan membaca ulang `.env`.

✅ PM2 siap jika `pm2 status` menampilkan `rexu-api` berstatus **online** dan `curl -sS http://127.0.0.1:3001/healthz` mengembalikan `{"ok":true,...}`.

---

## 9. nginx Setup

### 9.1 Pasang konfigurasi

```bash
# Salin contoh konfigurasi
sudo cp infra/nginx.conf.example /etc/nginx/sites-available/rexu

# Aktifkan site
sudo ln -sf /etc/nginx/sites-available/rexu /etc/nginx/sites-enabled/rexu

# Nonaktifkan site default agar tidak bentrok
sudo rm -f /etc/nginx/sites-enabled/default

# Edit domain, root, dan port jika perlu
sudo nano /etc/nginx/sites-available/rexu

# Uji konfigurasi
sudo nginx -t

# Terapkan
sudo systemctl reload nginx
```

### 9.2 Isi `infra/nginx.conf.example`

```nginx
server {
  listen 80;
  server_name rexu.ai.id;

  root /var/www/rexu/web;
  index index.html;
  client_max_body_size 12m;

  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /v1/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

Penjelasan tiap block:

- **`listen 80` / `server_name`** — certbot akan menambahkan block `443 ssl` dan redirect HTTP → HTTPS secara otomatis. Ganti `server_name` dengan domain Anda.
- **`root /var/www/rexu/web`** — lokasi hasil `rsync` dari `apps/web/dist/`. Harus sama dengan langkah 7.
- **`client_max_body_size 12m`** — menyesuaikan `bodyLimit` Fastify (12 MB) untuk request dengan gambar/vision.
- **`location /assets/`** — file ber-hash di-cache setahun dan `immutable`. `try_files $uri =404` mencegah fallback SPA untuk asset yang hilang (lebih mudah mendeteksi deploy tidak lengkap).
- **`location /api/`** — meneruskan API dashboard/auth ke Fastify. Header `X-Forwarded-*` penting agar `TRUST_PROXY=1` bekerja dan cookie/session aman. `X-Forwarded-For` ditimpa dengan `$remote_addr` agar client tidak bisa memalsukan IP untuk melewati rate limit.
- **`location /v1/`** — endpoint OpenAI-compatible. `proxy_buffering off` dan `proxy_cache off` wajib agar SSE/streaming tidak tertahan di buffer nginx.
- **`location /`** — fallback SPA: semua route yang bukan file statis diarahkan ke `index.html`, sehingga refresh di `/app/playground` tidak 404.

Tambahan yang disarankan untuk streaming panjang (letakkan di dalam `location /v1/`):

```nginx
    # Samakan dengan BANKAI_STREAM_TIMEOUT_MS (default 300000 ms)
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
```

Tanpa ini, nginx memakai timeout default 60 detik dan streaming panjang bisa terputus.

### 9.3 SSL dengan certbot

```bash
# Install certbot dan plugin nginx
sudo apt install -y certbot python3-certbot-nginx

# Generate SSL. Ganti domain sesuai konfigurasi Anda.
# www bersifat opsional; hanya tambahkan jika DNS www sudah pointing.
sudo certbot --nginx -d rexu.ai.id -d www.rexu.ai.id

# Uji perpanjangan otomatis (tidak benar-benar memperpanjang)
sudo certbot renew --dry-run

# Pastikan nginx otomatis start saat boot
sudo systemctl enable nginx
```

Setelah certbot selesai, konfigurasi akan memiliki block `listen 443 ssl` dan redirect dari port 80. Verifikasi:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I https://rexu.ai.id
```

✅ nginx siap jika `nginx -t` sukses dan `https://rexu.ai.id` menampilkan landing page.

---

## 9b. Alternatif: Caddy Setup

Caddy adalah alternatif nginx yang lebih ringkas: SSL otomatis tanpa certbot, dan konfigurasi lebih pendek. Pilih **salah satu** — nginx atau Caddy.

### 9b.1 File `infra/Caddyfile.example`

```caddyfile
rexu.ai {
    # Serve static web files
    root * /var/www/rexu/web
    file_server

    # Proxy API ke backend
    handle /api/* {
        reverse_proxy localhost:3001
    }

    # Proxy v1 (OpenAI-compatible endpoint) ke backend
    handle /v1/* {
        reverse_proxy localhost:3001 {
            # Penting untuk SSE/streaming
            flush_interval -1
        }
    }

    # Fallback ke index.html untuk SPA routing
    handle {
        try_files {path} /index.html
        file_server
    }

    # Compression
    encode gzip zstd
}

# Redirect www ke non-www (opsional)
www.rexu.ai {
    redir https://rexu.ai{uri} permanent
}
```

Ganti `rexu.ai` dengan domain Anda. Pastikan `root` sama dengan lokasi deploy web (`/var/www/rexu/web`).

### 9b.2 Install Caddy

```bash
# Dependensi repository
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https

# Tambahkan GPG key Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

# Tambahkan repository Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list

# Install
sudo apt update
sudo apt install caddy
```

### 9b.3 Setup

```bash
# Salin contoh konfigurasi
sudo cp infra/Caddyfile.example /etc/caddy/Caddyfile

# Edit domain dan path sesuai kebutuhan
sudo nano /etc/caddy/Caddyfile

# Aktifkan dan jalankan
sudo systemctl enable caddy
sudo systemctl start caddy

# Jika Caddy sudah berjalan dan Anda baru mengubah konfigurasi:
# sudo systemctl reload caddy
```

SSL otomatis: Caddy meminta dan memperbarui sertifikat Let's Encrypt sendiri. Tidak perlu certbot. Syaratnya port 80 dan 443 terbuka serta domain sudah pointing ke server.

⚠️ Jika nginx masih berjalan, Caddy **tidak bisa** bind port 80/443:

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
```

### 9b.4 Verifikasi

```bash
# Validasi sintaks konfigurasi
sudo caddy validate --config /etc/caddy/Caddyfile

# Cek status service
sudo systemctl status caddy

# Uji proxy API (401 = endpoint auth tercapai, bukan 404/502)
curl -i https://rexu.ai/api/auth/me

# Uji halaman utama
curl -I https://rexu.ai

# Log jika ada masalah
sudo journalctl -u caddy -f
```

> Catatan: di codebase ini tidak ada route `/api/health`. Health check API yang benar adalah `/healthz`, tetapi Caddyfile di atas tidak mem-proxy `/healthz`. Untuk smoke test proxy, gunakan `/api/auth/me` (harus mengembalikan `401` JSON) atau jalankan `curl -sS http://127.0.0.1:3001/healthz` langsung di server.

### 9b.5 Perbandingan nginx vs Caddy

| Aspek | nginx | Caddy |
|---|---|---|
| SSL | Manual (certbot) | Otomatis |
| Konfigurasi | Lebih verbose | Lebih ringkas |
| SSE/Streaming | Perlu konfigurasi tambahan | `flush_interval -1` |
| Performance | Sangat mature | Sangat baik |
| Rekomendasi | Jika sudah familiar | Jika mau yang simple |

⚠️ **Jangan jalankan nginx dan Caddy bersamaan** — keduanya butuh port 80 dan 443. Pilih salah satu.

---

## 10. Verifikasi Deploy

Jalankan checklist ini sebelum menyatakan situs live.

- [ ] **PM2 online**

  ```bash
  pm2 status
  # rexu-api harus berstatus online, restart count wajar
  ```

- [ ] **Health check API**

  ```bash
  curl -sS http://127.0.0.1:3001/healthz
  # {"ok":true,"service":"rexu-api","environment":"production"}
  ```

  > Catatan: route yang tersedia adalah `/healthz` dan `/readyz`. **Tidak ada** `/api/health` di codebase ini.

- [ ] **Database siap**

  ```bash
  curl -sS http://127.0.0.1:3001/readyz
  # {"ok":true,"database":"up"}
  ```

- [ ] **Reverse proxy ke API jalan**

  ```bash
  # Tanpa cookie harus 401, bukan 404/502
  curl -sS -o /dev/null -w '%{http_code}\n' https://rexu.ai.id/api/auth/me
  ```

- [ ] **Endpoint model mengembalikan daftar**

  ```bash
  curl -sS https://rexu.ai.id/v1/models \
    -H "Authorization: Bearer sk-rxu-..."
  # {"object":"list","data":[...]}
  ```

  `/v1/models` membutuhkan API key. Buat key dulu di dashboard (menu **API key**) setelah login.

- [ ] **Landing page muncul**

  ```bash
  curl -I https://rexu.ai.id
  # HTTP/2 200, content-type text/html
  ```

- [ ] **Login admin berhasil** — buka `https://rexu.ai.id/login`, masuk dengan `ADMIN_EMAIL` dan `ADMIN_PASSWORD`.

- [ ] **Admin → Status Upstream = OK** — buka `/admin`, lihat kartu **Status Upstream** (memanggil `GET /api/admin/health/upstream`).

- [ ] **Model sudah disinkronkan dan diaktifkan** — Admin → Models → Sinkronisasi, isi multiplier, aktifkan minimal satu model.

- [ ] **Saldo RC tersedia** — Admin → Users → Tambah / Kurangi RC.

- [ ] **Playground mengembalikan response** — kirim satu pesan di `/app/playground`.

- [ ] **Usage tercatat** — buka `/app/usage` atau Admin → Reconcile/Usage; baris baru muncul di `usage_logs`.

- [ ] **`npm run verify:bankai` semua OK**

  ```bash
  npm run verify:bankai
  # laporan tersimpan di tmp/bankai-verify.json
  ```

✅ Jika semua poin di atas tercentang, deploy dinyatakan live.

---

## 11. Update / Redeploy

Langkah saat ada perubahan kode. Jalankan dari root project.

```bash
# 1. Ambil kode terbaru (jika memakai git remote)
git pull

# 2. Install dependency baru jika package.json berubah
npm install

# 3. Jalankan migration baru jika ada
npm run db:migrate

# 4. Build ulang
npm run build -w @rexu/api
npm run build -w @rexu/web

# 5. Deploy web
sudo rsync -a --delete apps/web/dist/ /var/www/rexu/web/
sudo chown -R www-data:www-data /var/www/rexu/web

# 6. Restart API (JANGAN pakai --update-env jika ada BANKAI_API_KEY di shell)
pm2 restart rexu-api

# 7. Verifikasi
pm2 status
pm2 logs rexu-api --lines 20
curl -sS http://127.0.0.1:3001/healthz
curl -I https://rexu.ai.id
```

Catatan:

- Jika hanya frontend yang berubah, langkah 1, 2, 4 (web), dan 5 cukup. Tidak perlu restart API.
- Jika `.env` berubah, `pm2 restart rexu-api` sudah cukup untuk membaca ulang `.env`.
- Jika migrasi gagal, **jangan** lanjut restart. Perbaiki koneksi/URL database terlebih dahulu.
- `git pull` hanya berlaku jika repo memiliki remote. Jika deploy dilakukan dengan menyalin file, lewati langkah ini.

### Backfill multiplier BankAI

Sinkronisasi model mengisi `bankai_multiplier_bp` dari tabel terverifikasi di `packages/shared/src/bankai-multipliers.ts`. Model baru yang belum ada di tabel tetap memakai default 1x, nonaktif, dan ditandai di admin.

Untuk database lama yang terlanjur memiliki model dengan multiplier default 1x:

```bash
# Lihat rencana perubahan tanpa menulis apa pun
npm run backfill:bankai-multipliers

# Terapkan setelah hasil dry-run sesuai
npm run backfill:bankai-multipliers -- --apply
```

Script hanya mengubah baris yang masih memakai default 1x dan ada di tabel terverifikasi. Markup Rexu (`multiplier_bp`) tidak diubah.

---

## 12. Aktifkan Billing

Billing **tidak boleh** diaktifkan sebelum formula biaya upstream terverifikasi. Mengaktifkannya terlalu dini bisa memotong RC pelanggan dengan angka yang salah.

### 12.1 Prasyarat

- [ ] Shadow billing sudah berjalan minimal beberapa hari dengan `BILLING_ENABLED=false`.
- [ ] `npm run verify:billing` lulus.
- [ ] Coverage minimal 95% (target 100%). Script memakai toleransi 5%; angka di bawah itu berarti ada selisih yang belum dijelaskan.
- [ ] Semua model yang dijual sudah dikalibrasi `min_block`-nya.
- [ ] `BILLING_UPSTREAM_PARITY_VERIFIED=true` hanya diisi setelah pemeriksaan manual formula upstream selesai.

Jalankan verifikasi shadow billing (butuh API key user uji dan akses DB). Dalam mode shadow, `BILLING_ENABLED=false` tetapi setiap request tetap dicatat di `usage_logs` dengan status `skipped`; script membandingkan perkiraan biaya Rexu dengan selisih kuota BankAI:

```bash
# Billing harus tetap OFF saat shadow verification
TEST_API_KEY=sk-rxu-... npm run verify:billing

# Cek matematika billing tanpa menyentuh database/upstream
npm run check:billing

# Kalibrasi min block untuk model baru (billing harus OFF)
TEST_API_KEY=sk-rxu-... npm run calibrate:min-block
```

Laporan verifikasi ditulis ke `tmp/` (misalnya `tmp/shadow-billing-verify-*.json`). Baca ringkasannya: coverage, selisih quota upstream vs perhitungan Rexu, dan model yang belum terkalibrasi.

### 12.2 Langkah mengaktifkan

1. Edit `.env`:

   ```dotenv
   BILLING_ENABLED=true
   BILLING_UPSTREAM_PARITY_VERIFIED=true
   ```

2. Sinkronkan system settings (opsional, agar halaman admin konsisten):

   ```bash
   npm run db:seed
   ```

3. Restart API:

   ```bash
   # Aman tanpa menyalin environment shell
   pm2 restart rexu-api
   ```

   ⚠️ Jika `BILLING_ENABLED=true` tetapi `BILLING_UPSTREAM_PARITY_VERIFIED` bukan `true`, API akan **gagal boot**:

   ```text
   Invalid environment: BILLING_ENABLED requires BILLING_UPSTREAM_PARITY_VERIFIED=true ...
   ```

4. Test satu request:

   ```bash
   # Ganti MODEL_ID dan key dengan milik user uji
   curl -sS https://rexu.ai.id/v1/chat/completions \
     -H "Authorization: Bearer sk-rxu-..." \
     -H "content-type: application/json" \
     -d '{"model":"MODEL_ID","messages":[{"role":"user","content":"Halo"}]}'
   ```

5. Pastikan RC berkurang di dashboard (`/app`) dan usage log berstatus final:

   ```bash
   psql "postgres://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require" \
     -c "SELECT status, count(*) FROM usage_logs GROUP BY status ORDER BY status;"
   ```

   Status yang diharapkan: `finalized` (bukan `skipped`), dan tidak ada `reconciliation` yang menumpuk. Jika ada reservasi menggantung, jalankan:

   ```bash
   npm run reconcile
   ```

6. Pantau `usage_logs` dan `audit_logs` beberapa hari pertama. Jika ada selisih, kembalikan `BILLING_ENABLED=false` dan restart.

---

## 12b. Setup Midtrans

Integrasi pembayaran memakai Midtrans Core API dengan metode QRIS. API membuat transaksi QRIS, menampilkan QR di halaman Top Up, lalu menerima status pembayaran dari webhook Midtrans.

1. Login ke [dashboard.midtrans.com](https://dashboard.midtrans.com).
2. Buka **Settings → Access Keys**, salin **Server Key** dan **Client Key**.
3. Buka **Settings → Payment → Notification URL**, isi:

   ```text
   https://rexu.ai.id/api/payment/webhook
   ```

   Untuk sandbox, gunakan URL yang sama selama domain publik bisa diakses Midtrans. Jika memakai ngrok/tunnel saat testing, ganti host-nya sesuai tunnel.

4. Tambahkan ke `.env` di server:

   ```dotenv
   MIDTRANS_SERVER_KEY=...
   MIDTRANS_CLIENT_KEY=...
   MIDTRANS_ENV=sandbox
   ```

5. Jalankan migrasi dan restart API:

   ```bash
   npm run db:migrate
   pm2 restart rexu-api --update-env
   ```

6. Untuk production, aktifkan **QRIS** di **Settings → Payment Methods**, lalu ubah:

   ```dotenv
   MIDTRANS_ENV=production
   ```

   Gunakan Server Key/Client Key dari environment production, bukan sandbox, lalu restart API.

7. Verifikasi:

   ```bash
   curl -sS http://127.0.0.1:3001/healthz
   pm2 logs rexu-api --lines 50
   ```

   Lalu login sebagai user, buka **Top Up**, pilih paket, klik **Bayar dengan QRIS**, dan pastikan QR muncul beserta countdown 30 menit.

Catatan:
- Webhook wajib memiliki signature valid. Request tanpa signature yang benar ditolak `401`.
- Webhook yang sudah diproses bersifat idempotent; order yang sudah `paid` tidak akan menambah RC dua kali.
- Order yang kedaluwarsa tetap tersimpan di database dengan status `expired`.
- Endpoint admin: `GET /api/admin/orders` dan `GET /api/admin/orders/:id`.

---

## 12c. Setup Email

Email dipakai untuk mengirim **kode OTP registrasi** (6 digit) lewat Skymail. Tanpa konfigurasi ini, `POST /api/auth/send-otp` akan gagal dan API tidak bisa boot karena environment wajib belum lengkap.

1. Buat akun di [skymail.ink](https://skymail.ink) dan login ke dashboard.
2. Salin **API Token** dan **Account ID** dari halaman pengaturan/akun.
3. Verifikasi domain pengirim (misalnya `rexu.ai.id`) di Skymail. Tambahkan record DNS yang diminta (SPF/DKIM) agar email tidak masuk spam.
4. Tambahkan ke `.env` di server:

   ```dotenv
   SKYMAIL_API_URL=https://skymail.ink/api/email/send
   SKYMAIL_TOKEN=...
   SKYMAIL_ACCOUNT_ID=1
   SKYMAIL_SENDER_NAME=Rexu
   SKYMAIL_SENDER_FROM=noreply@rexu.ai.id
   ```

5. Jalankan migrasi dan restart API:

   ```bash
   npm run db:migrate
   pm2 restart rexu-api --update-env
   ```

6. Pastikan registrasi publik aktif. Endpoint register menolak pendaftaran jika system setting `registration_mode` bukan `public`:

   ```bash
   # cara termudah: set REGISTRATION_MODE=public di .env lalu seed ulang
   REGISTRATION_MODE=public npm run db:seed
   ```

   Ini akan menimpa setting `registration_mode` menjadi `public`. Hati-hati, seed juga menulis setting lain sesuai nilai env.

7. Verifikasi pengiriman email:

   ```bash
   curl -sS -X POST http://127.0.0.1:3001/api/auth/send-otp \
     -H 'content-type: application/json' \
     -d '{"email":"alamat-uji@domain.id"}'
   ```

   Respons sukses:

   ```json
   { "message": "Kode verifikasi dikirim ke email kamu." }
   ```

   Cek inbox (dan folder spam). Kode berlaku 10 menit, bisa dikirim ulang setelah 60 detik, dan maksimal 5 percobaan salah per kode.

8. Alur endpoint:

   - `POST /api/auth/send-otp` → kirim OTP ke email.
   - `POST /api/auth/register` → butuh `name`, `email`, `password`, dan `otp`.

Catatan:
- Email OTP disimpan sebagai hash argon2, bukan plaintext.
- OTP lama yang belum dipakai dihapus setiap kali kode baru dibuat.
- Jika pengiriman email gagal, baris OTP baru ikut dihapus supaya cooldown 60 detik tidak memblokir retry.
- `SKYMAIL_SENDER_FROM` dipakai sebagai identitas pengirim yang didokumentasikan; pastikan domainnya sama dengan yang diverifikasi di Skymail.

---

## 13. Monitoring & Maintenance

### 13.1 Perintah harian

```bash
# Log real-time
pm2 logs rexu-api

# Status semua proses
pm2 status

# Rekonsiliasi reservation yang kedaluwarsa
npm run reconcile

# Verifikasi shadow billing (billing OFF)
TEST_API_KEY=sk-rxu-... npm run verify:billing

# Kalibrasi min block model baru (billing OFF)
TEST_API_KEY=sk-rxu-... npm run calibrate:min-block

# Cek koneksi dan kuota BankAI (tanpa mengekspor key ke shell)
curl -sS \
  -H "Authorization: Bearer $(grep -E '^BANKAI_API_KEY=' .env | cut -d= -f2-)" \
  https://bankai.web.id/api/v1/quota
```

> Jika nilai di `.env` dibungkus tanda kutip, hapus tanda kutipnya sebelum dipakai di perintah di atas.

### 13.2 Notifikasi Telegram

Monitor Telegram sudah aktif di codebase (`apps/api/src/modules/monitor/`). Cron hanya berjalan jika `TELEGRAM_BOT_TOKEN` **dan** `TELEGRAM_CHAT_ID` terisi; jika salah satu kosong, API mencatat `Telegram tidak dikonfigurasi, monitor dinonaktifkan` dan tidak ada pengecekan berkala.

Yang dikirim:

| Pengecekan | Interval default | Kapan notifikasi dikirim |
|---|---|---|
| Kuota BankAI | 15 menit | Saat pemakaian melewati `MONITOR_QUOTA_WARN_PCT` atau `MONITOR_QUOTA_CRITICAL_PCT` untuk pertama kali. Reset otomatis setelah kuota turun (mis. topup). |
| Kesehatan upstream | 30 menit | Saat status berubah: `ok → error` (down), `ok → degraded`, atau `error/degraded → ok` (recovered). Cek pertama hanya menyimpan baseline. |
| Pending rekonsiliasi | 1 jam | Jika ada `usage_logs.status = 'reconciliation'` lebih lama dari `MONITOR_RECONCILE_PENDING_HOURS`, maksimal sekali per jam. |

Cek pertama dijalankan 30 detik setelah server listen, lalu mengikuti interval. State notifikasi disimpan di memori, jadi restart API mengulang baseline (bisa memicu satu notifikasi ulang).

Cara menguji:

```bash
# Login admin dulu, simpan cookie
curl -sS -c /tmp/rexu-cookies.txt -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@rexu.ai.id","password":"PASSWORD_ADMIN"}'

# Kirim pesan Rich HTML uji ke Telegram
curl -sS -b /tmp/rexu-cookies.txt -X POST http://127.0.0.1:3001/api/admin/monitor/test-telegram

# Jalankan ketiga pengecekan sekarang tanpa menunggu interval
curl -sS -b /tmp/rexu-cookies.txt -X POST http://127.0.0.1:3001/api/admin/monitor/check-now
```

`test-telegram` mengembalikan `{"sent":true}` jika terkirim, atau `{"sent":false,"error":"..."}` (HTTP tetap `200`). `check-now` mengembalikan `{"triggered":true,"timestamp":"..."}`; kegagalan satu pengecekan dicatat di log dan tidak menggagalkan request. Notifikasi yang gagal terkirim tidak mengubah state, sehingga dicoba lagi pada interval berikutnya.

Selain Telegram, tetap pantau:

- `pm2 logs rexu-api` untuk error runtime dan baris `Monitor crons started`.
- `GET /api/admin/health/upstream` lewat halaman Admin untuk status BankAI.
- Query `usage_logs` untuk status `reconciliation` yang menumpuk.

### 13.3 Lokasi log

| Log | Lokasi |
|---|---|
| PM2 stdout | `~/.pm2/logs/rexu-api-out.log` |
| PM2 stderr | `~/.pm2/logs/rexu-api-error.log` |
| PM2 daemon | `~/.pm2/pm2.log` |
| nginx access | `/var/log/nginx/access.log` |
| nginx error | `/var/log/nginx/error.log` |
| Caddy | `journalctl -u caddy` |

Rotasi log PM2 (opsional):

```bash
# Plugin resmi PM2 untuk rotasi log
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
```

### 13.4 Backup database

Install client PostgreSQL jika belum ada:

```bash
sudo apt install -y postgresql-client
```

Backup:

```bash
# Ganti connection string dengan milik Anda
# Jika memakai CA Aiven, tambahkan PGSSLROOTCERT
PGSSLROOTCERT=/root/rexu-ai-gateway/cert/ca.pem \
pg_dump "postgres://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require" \
  --no-owner --no-privileges \
  -f "backup-rexu-$(date +%F-%H%M).sql"
```

Simpan file backup di luar VPS (object storage atau mesin lain). Backup yang hanya ada di VPS yang sama tidak melindungi dari kehilangan server.

### 13.5 Restore database

⚠️ Restore menimpa data. Lakukan pada database kosong atau setelah backup terbaru.

```bash
# Restore ke database tujuan
PGSSLROOTCERT=/root/rexu-ai-gateway/cert/ca.pem \
psql "postgres://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require" \
  -f backup-rexu-2026-11-18-0900.sql
```

Setelah restore, jalankan `npm run db:migrate` untuk memastikan schema berada di versi terbaru, lalu restart API.

---

## 14. Troubleshooting

| Masalah | Kemungkinan Penyebab | Solusi |
|---|---|---|
| API mengembalikan kutipan motivasi, bukan jawaban model | `BANKAI_API_KEY` lama ada di environment shell dan ikut tersalin ke PM2 | `pm2 restart rexu-api`, atau `env -u BANKAI_API_KEY pm2 restart rexu-api --update-env`. Lalu cek `.env`. |
| Billing tidak memotong RC | `BILLING_ENABLED=false`, atau `BILLING_UPSTREAM_PARITY_VERIFIED` belum `true` | Set keduanya `true`, `pm2 restart rexu-api`, pastikan model punya multiplier dan usage log berstatus `finalized`. |
| Login gagal / session hilang | `SESSION_SECRET` berubah, atau `APP_URL` berbeda dari origin browser | Hapus cookie `rexu_session` di browser, login ulang. Samakan `APP_URL` dengan URL yang dibuka. |
| Migration gagal | `DATABASE_URL`/`DATABASE_URL_DIRECT` salah, database tidak bisa diakses, atau `DATABASE_CA_PATH` tidak ada | Uji koneksi dengan `psql`, cek path `ca.pem`, pastikan `sslmode=require`. |
| PM2 tidak start | Port 3001 sudah dipakai proses lain | `sudo lsof -i :3001` (install `lsof` jika belum ada), hentikan proses lama, lalu `pm2 restart rexu-api`. |
| Web tidak update setelah deploy | Cache browser atau nginx belum reload | `sudo nginx -s reload` (nginx) / `sudo systemctl reload caddy`, lalu hard refresh (Ctrl+Shift+R). Pastikan `index.html` ikut tersalin. |
| Request timeout | `BANKAI_TIMEOUT_MS` terlalu kecil untuk prompt panjang | Naikkan ke `180000` (dan `BANKAI_STREAM_TIMEOUT_MS=300000`), restart API, sesuaikan `proxy_read_timeout` nginx. |
| Notifikasi Telegram tidak masuk | Token/chat ID kosong, bot belum diundang ke grup, atau `TELEGRAM_THREAD_ID` salah | Pastikan `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` terisi di `.env`, bot sudah menjadi anggota grup/topik, lalu `pm2 restart rexu-api`. Uji dengan `POST /api/admin/monitor/test-telegram`; cek `pm2 logs rexu-api` untuk detail error dari Telegram. |
| Caddy tidak bisa bind port 80/443 | nginx masih berjalan | `sudo systemctl stop nginx && sudo systemctl disable nginx`, lalu `sudo systemctl restart caddy`. |
| SSL gagal di Caddy | Domain belum pointing ke server / DNS belum propagate | Pastikan A record benar, cek `dig rexu.ai.id`, tunggu propagasi, lalu `sudo systemctl restart caddy`. |
| SSE/streaming putus di Caddy | `flush_interval` tidak diset | Tambahkan `flush_interval -1` di block `reverse_proxy /v1/*`, reload Caddy. |
| `502 Bad Gateway` dari reverse proxy | API mati, crash, atau port tidak cocok | `pm2 status`, `pm2 logs rexu-api --lines 50`, `curl -sS http://127.0.0.1:3001/healthz`. |
| API gagal boot: `Invalid environment` | `SESSION_SECRET`/`API_KEY_PEPPER` kurang dari 32 karakter, atau `BANKAI_API_KEY` kosong | Perbaiki `.env`, lalu `pm2 restart rexu-api`. Cek `pm2 logs rexu-api`. |
| API gagal boot: `BILLING_ENABLED requires ...` | Billing aktif tanpa parity terverifikasi | Set `BILLING_UPSTREAM_PARITY_VERIFIED=true` setelah verifikasi, atau set `BILLING_ENABLED=false`. |
| `Origin tidak diizinkan` di browser | `APP_URL`/`TRUSTED_ORIGINS` tidak memuat origin yang dipakai | Tambahkan origin lengkap (skema + host + port) ke `TRUSTED_ORIGINS`, restart API. |
| Email OTP tidak masuk | `SKYMAIL_TOKEN`/`SKYMAIL_ACCOUNT_ID` salah, domain pengirim belum diverifikasi, atau masuk spam | Cek `pm2 logs rexu-api`, uji `POST /api/auth/send-otp`, verifikasi DNS domain di dashboard Skymail, cek folder spam. |
| Log berisi `Authentication has expired` atau `respons Skymail kosong` | `SKYMAIL_TOKEN` kedaluwarsa | Login ulang ke Skymail, salin token baru ke `.env`, lalu `pm2 restart rexu-api --update-env`. |
| `POST /api/auth/send-otp` balas `429` | Baru minta kode kurang dari 60 detik lalu | Tunggu 60 detik, lalu minta lagi. |
| `POST /api/auth/register` balas `403` | `registration_mode` masih `closed` | Set `REGISTRATION_MODE=public` lalu `npm run db:seed`, atau ubah system setting `registration_mode`. |
| `GET /api/health` 404 | Route health yang benar adalah `/healthz` | Gunakan `curl -sS http://127.0.0.1:3001/healthz` atau `/readyz`. |
| `/v1/models` kosong | Belum sinkronisasi model atau semua model nonaktif | Admin → Models → Sinkronisasi, isi multiplier, aktifkan model. |

---

## 15. Kontak & Support

<!-- Isi bagian ini nanti: nama, email, Telegram/Slack, jam operasional, dan prosedur eskalasi. -->