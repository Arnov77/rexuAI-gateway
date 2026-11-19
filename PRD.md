# Build Rexu — AI Token Marketplace & Multi-Model AI Platform

Bertindak sebagai Senior Software Architect, Senior Backend Engineer, Full-Stack Developer, dan UI/UX Designer.

Saya ingin membangun platform bernama **Rexu**, yaitu platform marketplace AI yang memungkinkan pelanggan membeli token quota dan menggunakan berbagai model AI dari satu tempat.

Rexu menggunakan BankAI (`https://bankai.web.id`) sebagai upstream AI provider untuk mengakses 30+ model AI.

Fokus utama Rexu adalah menyediakan layanan AI untuk pelanggan melalui website dan API, dengan sistem token quota, model multiplier, AI Playground, Developer API, serta dashboard admin dan pelanggan.

Tujuan akhirnya adalah membangun aplikasi production-ready yang dapat dikembangkan secara bertahap, bukan sekadar demo.

## 1. Technology Stack

Gunakan:

- Node.js 22
- TypeScript
- Fastify untuk backend API
- PostgreSQL untuk database
- Prisma ORM atau Drizzle ORM
- React untuk frontend
- Tailwind CSS untuk styling
- Redis opsional untuk caching dan rate limiting
- PM2 untuk deployment
- Swagger/OpenAPI untuk dokumentasi API

Gunakan arsitektur modular, scalable, dan mudah dipelihara.

Pisahkan backend, frontend, business logic, provider integration, dan billing engine dengan jelas.

## 2. Upstream AI Provider: BankAI

BankAI merupakan upstream provider utama Rexu.

Base URL:

`https://bankai.web.id/api`

Authentication menggunakan API key milik pemilik Rexu yang disimpan melalui environment variable.

Contoh:

`BANKAI_API_KEY=...`

Jangan pernah mengekspos upstream API key kepada pelanggan maupun frontend.

Semua request AI dari pelanggan harus melewati backend Rexu, kemudian diteruskan ke BankAI menggunakan API key tersebut.

Endpoint utama:

- `/api/chat/completions`
- Endpoint daftar model harus diverifikasi berdasarkan dokumentasi atau pengujian API BankAI sebelum diimplementasikan.

Gunakan format OpenAI-compatible sejauh didukung upstream.

Buat provider adapter agar integrasi BankAI tidak tercampur dengan business logic Rexu. Dengan begitu, provider lain dapat ditambahkan di masa depan tanpa mengubah keseluruhan aplikasi.

## 3. AI Model Catalog

Rexu harus mendukung 30+ model AI dan memungkinkan penambahan model baru.

Setiap model memiliki:

- Model ID.
- Display name.
- Provider.
- Deskripsi.
- Multiplier.
- Status enabled/disabled.
- Vision support.
- Streaming support.
- Kategori atau kemampuan model jika tersedia.
- Last synchronized timestamp.

Fitur:

- Menampilkan katalog model kepada pelanggan.
- Menampilkan informasi dan kemampuan setiap model.
- Sinkronisasi daftar model dari BankAI jika endpoint tersedia.
- Deteksi model baru dan model yang sudah tidak tersedia.
- Admin dapat mengubah multiplier.
- Admin dapat mengaktifkan atau menonaktifkan model.
- Model baru tidak boleh otomatis diaktifkan sebelum multiplier dan konfigurasi billing ditentukan.
- Perubahan multiplier tidak boleh mengubah histori billing sebelumnya.

Jika BankAI tidak menyediakan multiplier melalui API, kelola multiplier melalui database Rexu.

Jangan mengarang model, kemampuan, atau multiplier.

## 4. AI Playground

Sediakan fitur AI Playground agar pelanggan dapat menggunakan model AI langsung dari website tanpa harus membuat API integration sendiri.

Fitur utama:

- Memilih model AI.
- Chat interface.
- Mengirim pesan dan menerima respons.
- Menampilkan riwayat percakapan.
- Mendukung streaming response.
- Menampilkan indikator model yang sedang digunakan.
- Menampilkan penggunaan token setiap request jika tersedia.
- Mengurangi token quota berdasarkan billing engine.
- Mendukung vision jika model mendukungnya.
- Menampilkan pesan error yang jelas.

Percakapan harus terhubung dengan akun pelanggan.

Jangan mengekspos API key BankAI di browser.

Pastikan request dari Playground menggunakan sistem autentikasi dan billing yang sama dengan API publik Rexu.

## 5. AI Token Marketplace

Pelanggan dapat membeli token quota untuk menggunakan layanan AI Rexu.

Gunakan sistem **Token Quota**, bukan credit atau saldo rupiah sebagai unit penggunaan AI.

Setiap pelanggan memiliki:

- Total quota.
- Used quota.
- Remaining quota.
- Riwayat penambahan quota.
- Riwayat penggunaan quota.

Sediakan halaman marketplace untuk menampilkan paket token yang tersedia.

Contoh paket (hanya contoh konfigurasi awal, bukan harga final):

- 1 juta token.
- 5 juta token.
- 10 juta token.
- 50 juta token.

Setiap paket memiliki:

- Nama paket.
- Jumlah token.
- Harga dalam Rupiah.
- Deskripsi.
- Status aktif/nonaktif.
- Masa berlaku jika diterapkan.
- Urutan tampilan.

Admin dapat membuat, mengubah, mengaktifkan, dan menonaktifkan paket.

Pelanggan dapat:

- Melihat daftar paket.
- Memilih paket.
- Membuat pesanan.
- Melihat status pembayaran.
- Melihat riwayat pembelian.
- Menerima quota setelah pembayaran terverifikasi.

Untuk tahap awal, sediakan penambahan quota secara manual oleh admin. Siapkan arsitektur agar payment gateway dapat ditambahkan kemudian.

Jangan menganggap pembayaran berhasil sebelum diverifikasi melalui mekanisme pembayaran yang sah.

## 6. Token Quota Billing Engine

Billing engine harus menjadi satu-satunya sumber perhitungan penggunaan token, baik untuk AI Playground maupun Developer API.

Rumus billing:

`raw_tokens = prompt_tokens + completion_tokens`

`deducted_tokens = ceil(raw_tokens * model_multiplier)`

Contoh:

| Model | Raw tokens | Multiplier | Deducted |
|---|---:|---:|---:|
| DeepSeek Flash | 1000 | 2x | 2000 |
| Model A | 1000 | 1x | 1000 |
| Model B | 1000 | 10x | 10000 |

Ambil usage dari response asli BankAI:

- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `completion_tokens_details.reasoning_tokens`
- `prompt_tokens_details.cached_tokens`

Jangan menjumlahkan reasoning_tokens atau cached_tokens lagi karena keduanya sudah termasuk dalam token utama.

Prioritaskan usage aktual dari BankAI, bukan estimasi tokenizer lokal.

Jika response tidak menyediakan usage:

- Jangan mengarang angka pemakaian.
- Simpan status billing sebagai pending reconciliation.
- Catat request ID dan informasi yang diperlukan untuk investigasi.
- Sediakan mekanisme rekonsiliasi.
- Jangan melakukan final deduction berdasarkan estimasi yang belum terverifikasi.

Untuk streaming:

- Gunakan `stream_options.include_usage` jika didukung upstream.
- Ambil usage dari chunk terakhir.
- Pastikan usage tidak diproses lebih dari satu kali.
- Jika usage tidak tersedia, jangan melakukan final deduction berdasarkan estimasi.

Gunakan database transaction dan mekanisme idempotency untuk mencegah quota negatif atau double deduction.

Simpan multiplier yang digunakan pada setiap usage log agar perubahan multiplier tidak memengaruhi histori penggunaan.

Pisahkan dengan jelas:

- Raw tokens: penggunaan token aktual dari provider.
- Deducted tokens: token yang dipotong dari quota pelanggan setelah multiplier.

Jangan menganggap penggunaan di dashboard BankAI selalu sama dengan `usage.total_tokens` sebelum dilakukan pengujian dan verifikasi.

## 7. Developer API dan API Key

Sediakan Developer API sebagai salah satu fitur Rexu.

Setiap pelanggan dapat memiliki beberapa API key.

Format:

`sk-rxu-xxxxxxxxxxxxxxxx`

Fitur:

- Generate API key.
- Revoke API key.
- Multiple API keys per akun.
- Nama API key.
- Status active/revoked.
- Rate limit.
- Batas penggunaan opsional.
- Riwayat penggunaan setiap key.

Simpan hash API key di database, bukan raw API key.

Raw key hanya ditampilkan satu kali ketika dibuat.

### Public API

Implementasikan:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `GET /v1/usage`

Contoh konfigurasi pelanggan:

`BASE_URL=https://api.rexu.id/v1`

`API_KEY=sk-rxu-xxxxxxxx`

Pastikan pelanggan dapat menggunakan Rexu seperti menggunakan OpenAI API.

Request harus mendukung:

- Model selection.
- Messages.
- Temperature.
- Max tokens sesuai kompatibilitas upstream.
- Streaming.
- System prompt.
- Vision jika didukung model.
- Parameter lain yang didukung upstream.

Jangan menghapus parameter valid secara sembarangan ketika meneruskan request ke BankAI.

Pertahankan format response OpenAI-compatible semaksimal mungkin.

## 8. Customer Dashboard

Buat dashboard pelanggan yang modern, responsif, dan mudah digunakan.

### Overview

- Total quota.
- Used tokens.
- Remaining tokens.
- Penggunaan terbaru.
- Grafik penggunaan.
- Ringkasan transaksi.

### AI Models

- Katalog model.
- Informasi model.
- Multiplier setiap model jika informasi ini memang ditampilkan kepada pelanggan.
- Kemampuan vision dan streaming.

### AI Playground

- Chat interface.
- Model selector.
- Riwayat percakapan.
- Informasi penggunaan token.

### Token Marketplace

- Daftar paket token.
- Detail paket.
- Pembelian token.
- Riwayat pesanan dan pembayaran.

### Developer

- API key management.
- Generate dan revoke API key.
- Dokumentasi API.
- Contoh integrasi.
- Riwayat penggunaan API.

### Usage

- Riwayat penggunaan.
- Filter berdasarkan model.
- Filter berdasarkan tanggal.
- Raw tokens.
- Deducted tokens.
- Multiplier yang digunakan.

Gunakan istilah Token Quota, bukan Credit.

## 9. Admin Dashboard

Buat dashboard admin dengan branding Rexu.

### Overview

- Total pengguna.
- Total request.
- Total raw token usage.
- Total deducted tokens.
- Total quota terjual.
- Penggunaan per model.
- Statistik transaksi.

### User Management

- Daftar pengguna.
- Detail pengguna.
- Membuat akun pengguna jika diperlukan.
- Mengaktifkan atau menonaktifkan akun.
- Melihat quota dan penggunaan.
- Menambahkan atau mengurangi quota secara manual.

### Model Management

- Daftar model.
- Sinkronisasi model.
- Mengaktifkan atau menonaktifkan model.
- Mengubah multiplier.
- Mengatur konfigurasi model.

### Token Package Management

- Membuat paket.
- Mengubah harga dan jumlah token.
- Mengaktifkan atau menonaktifkan paket.

### Transaction Management

- Melihat transaksi.
- Memverifikasi pembayaran manual jika digunakan.
- Melihat riwayat penambahan quota.

### Usage Management

- Usage logs.
- Filter berdasarkan pengguna, model, dan tanggal.
- Status billing.
- Pending reconciliation.

### System Settings

- Status koneksi BankAI.
- Pengaturan sistem.
- Pengaturan billing.
- Pengaturan keamanan.

Admin dapat mengatur multiplier tanpa harus mengubah source code.

## 10. API Endpoints

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Metode registrasi harus configurable. Jangan mengasumsikan pendaftaran publik atau manual admin sebelum keputusan ditentukan.

### Customer API

- `GET /api/user/profile`
- `GET /api/user/usage`
- `GET /api/user/transactions`
- `GET /api/user/keys`
- `POST /api/user/keys`
- `DELETE /api/user/keys/:id`
- `GET /api/user/models`
- `GET /api/user/conversations`
- `POST /api/user/conversations`

### Marketplace API

- `GET /api/packages`
- `GET /api/orders`
- `POST /api/orders`

### Admin API

- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/models`
- `POST /api/admin/models/sync`
- `PATCH /api/admin/models/:id`
- `POST /api/admin/users/:id/quota`
- `GET /api/admin/usage`
- `GET /api/admin/transactions`
- `GET /api/admin/packages`
- `POST /api/admin/packages`
- `PATCH /api/admin/packages/:id`

Semua endpoint harus memiliki validasi input dan autentikasi sesuai hak aksesnya.

Sesuaikan endpoint jika ada kebutuhan arsitektur yang lebih baik, tetapi jangan menghilangkan fitur inti.

## 11. Database Architecture

Rancang database PostgreSQL dengan tabel minimal:

- users
- api_keys
- models
- wallets
- usage_logs
- transactions
- quota_adjustments
- token_packages
- orders
- conversations
- messages
- system_settings
- audit_logs

Tambahkan:

- Foreign keys.
- Indexes.
- Unique constraints.
- Timestamps.
- Proper database relations.

Wallet harus mendukung operasi atomik untuk mencegah pengurangan quota ganda.

Simpan multiplier yang digunakan pada setiap usage log.

Pastikan transaksi quota dan penggunaan AI tercatat secara konsisten.

Sediakan migration dan seed data.

## 12. Security

Implementasikan:

- Password hashing dengan Argon2 atau bcrypt.
- Secure authentication.
- Role-based access control.
- API key hashing.
- Rate limiting.
- Request validation.
- CORS configuration.
- Security headers.
- SQL injection protection.
- Audit logs untuk tindakan admin.
- Environment variable untuk semua secret.
- Jangan pernah mencatat API key mentah dalam log.
- Validasi ownership setiap resource pelanggan.
- Proteksi terhadap quota race condition.
- Proteksi terhadap replay atau double processing pada webhook pembayaran.

## 13. Payment Architecture

Siapkan sistem pembayaran untuk pembelian token quota.

Tahap awal:

- Admin dapat menambahkan quota secara manual.
- Setiap penambahan quota tercatat sebagai transaksi.
- Pelanggan dapat membuat pesanan paket token.
- Status pesanan harus jelas: pending, paid, failed, expired, atau cancelled.
- Quota hanya ditambahkan setelah pembayaran benar-benar terverifikasi.

Siapkan abstraksi payment provider agar payment gateway dapat diintegrasikan tanpa mengubah sistem marketplace.

Masa aktif quota configurable, dengan default tidak kedaluwarsa.

Jangan mengaktifkan sistem pembayaran otomatis sebelum mekanisme verifikasinya selesai diuji.

## 14. UI/UX dan Branding

Gunakan branding **Rexu**.

Buat desain modern, profesional, dan konsisten.

Prioritaskan:

- Tampilan marketplace yang jelas.
- Katalog model yang mudah dijelajahi.
- Dashboard pelanggan yang informatif.
- AI Playground yang nyaman digunakan.
- Dashboard admin yang efisien.
- Responsif untuk desktop dan mobile.
- Loading state, empty state, error state, dan success state yang baik.

Jangan membuat UI yang hanya terlihat bagus tetapi tidak terhubung dengan backend sebenarnya.

Hindari mock data sebagai pengganti fitur production.

## 15. Development Workflow

Kerjakan secara bertahap.

### Phase 1 — Core Foundation

- Project setup.
- Database schema.
- Authentication.
- Customer API key.
- BankAI provider adapter.
- Model catalog.
- Chat completions proxy.
- Basic AI Playground.

### Phase 2 — Billing Engine

- Usage tracking.
- Multiplier billing.
- Token quota.
- Streaming support.
- Idempotency.
- Concurrency handling.
- Pending reconciliation.

### Phase 3 — Marketplace

- Token package management.
- Order management.
- Pembelian token.
- Manual quota top-up.
- Payment gateway preparation.

### Phase 4 — Dashboard

- Customer dashboard.
- Admin dashboard.
- Model management.
- API key management.
- Usage analytics.
- Conversation history.

### Phase 5 — Production Readiness

- Automated testing.
- Security hardening.
- API documentation.
- Production configuration.
- PM2 deployment.
- Monitoring.
- Database backup.

Pastikan setiap fase dapat dijalankan dan diuji sebelum melanjutkan ke fase berikutnya.

## 16. Important Instructions

- Sebelum coding, periksa struktur project yang sudah ada.
- Jangan menghapus atau merusak kode yang sudah berjalan.
- Jangan mengasumsikan endpoint atau fitur BankAI yang belum diverifikasi.
- Jangan membuat multiplier palsu.
- Jangan menganggap `usage.total_tokens` selalu sama dengan dashboard provider sebelum diuji.
- Jangan menggunakan estimasi token sebagai billing final jika usage aktual tersedia.
- Buat error handling yang konsisten.
- Buat automated tests untuk billing, concurrency, streaming, API authentication, dan transaksi quota.
- Jangan menggunakan mock data sebagai pengganti implementasi production.
- Jangan membuat seluruh aplikasi dalam satu file.
- Jangan berhenti pada pseudocode atau contoh implementasi.
- Pastikan frontend dan backend benar-benar terintegrasi.
- Dokumentasikan setiap konfigurasi dan environment variable.
- Jangan mengarang spesifikasi provider.

## 17. Starting Instruction

Mulai dengan:

1. Menganalisis kebutuhan Rexu.
2. Memeriksa struktur project yang sudah ada.
3. Menyusun arsitektur aplikasi.
4. Menentukan struktur folder.
5. Menentukan skema database.
6. Mengidentifikasi detail BankAI yang perlu diverifikasi.
7. Menyusun rencana implementasi bertahap.

Setelah itu implementasikan Phase 1 terlebih dahulu.

Sampaikan file yang dibuat, konfigurasi yang diperlukan, perintah instalasi, dan cara menjalankan project.

Jika ada detail BankAI yang belum diketahui, tanyakan atau buat adapter yang bisa dikonfigurasi. Jangan mengarang spesifikasi API.

**Prioritas utama: bangun Rexu sebagai platform marketplace AI berbasis token yang benar-benar berfungsi. Developer API adalah salah satu fitur Rexu, bukan keseluruhan produk.**
