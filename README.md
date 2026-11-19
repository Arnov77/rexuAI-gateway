# Rexu

Marketplace AI dengan gateway multi-model. Phase 1 mencakup autentikasi, API key, katalog model, proxy chat, dan Playground.

## Stack

- Node.js 22, TypeScript, Fastify 5
- PostgreSQL Aiven, Drizzle ORM
- React 19, Vite, Tailwind CSS 4
- PM2 dan nginx untuk produksi

## Setup

```bash
npm install
cp .env.example .env
```

Isi `.env`:

- `DATABASE_URL` dan `DATABASE_URL_DIRECT` dengan password Aiven.
- `DATABASE_CA_PATH` ke file `ca.pem` absolut, misalnya `/root/rexu-ai-gateway/cert/ca.pem`.
- `SESSION_SECRET` dan `API_KEY_PEPPER` minimal 32 karakter.
- `BANKAI_API_KEY` dengan key milik pemilik Rexu.
- `ADMIN_EMAIL` dan `ADMIN_PASSWORD` untuk seed admin.

## Database

```bash
npm run db:migrate
npm run db:seed
npm run seed:admin
npm run verify:bankai
npm run check:billing
ALLOW_BILLING_TESTS=true npm run test:billing
ALLOW_BILLING_TESTS=true npm run test:upstream-billing
```

`verify:bankai` menulis laporan tanpa secret ke `tmp/bankai-verify.json`.

## Development

```bash
npm run dev -w @rexu/api
npm run dev -w @rexu/web
```

API berjalan di `http://localhost:3001`. Web berjalan di `http://localhost:21072` (lihat `apps/web/vite.config.ts`) dan mem-proxy `/api` serta `/v1` ke API.

## Build

```bash
npm run build -w @rexu/api
npm run build -w @rexu/web
npm run typecheck
npm run lint
```

## Produksi

```bash
pm2 start infra/ecosystem.config.cjs
pm2 save
```

Salin `apps/web/dist` ke `/var/www/rexu/web`, lalu gunakan `infra/nginx.conf.example` sebagai dasar konfigurasi nginx. Nginx mem-proxy `/api` dan `/v1` ke API, dan mematikan buffer untuk SSE.

## Phase 1

- Login admin dan customer memakai session cookie.
- Registrasi publik ditutup.
- API key `sk-rxu-...` disimpan sebagai HMAC-SHA256.
- Model sync dari BankAI. Model baru selalu nonaktif dan tanpa multiplier.
- Multiplier disimpan dalam basis points. `10000` berarti `1x`.
- `/v1/chat/completions` mendukung non-streaming dan streaming.
- Usage dari BankAI disimpan. Billing belum memotong kuota.
- Playground menyimpan percakapan dan pesan.
- Rate limit per API key aktif.

## Phase 2 billing

- Reservation atomik memakai `total_credits - used_credits - reserved_credits`.
- 1 RC = 1.000 token BankAI. Settlement menyimpan `tokens_billed`, `credits_deducted`, dan `credits_reserved`.
- Settlement memakai snapshot `multiplier_bp` dan `bankai_multiplier_bp` dari usage log.
- Settlement tidak mengambil jatah reservation aktif lain.
- Upstream error, timeout, disconnect, dan missing usage masuk reconciliation.
- Reservation kedaluwarsa dirilis oleh `npm run reconcile` atau endpoint admin.
- Setiap reserve, settle, release, dan reconcile dicatat ke `audit_logs`.
- `BILLING_ENABLED=true` diblokir kecuali `BILLING_UPSTREAM_PARITY_VERIFIED=true`.
- Admin dapat melihat `GET /api/admin/usage?status=reconciliation`, menjalankan `POST /api/admin/usage/reconcile-expired`, dan menyelesaikan satu log lewat `POST /api/admin/usage/:id/reconcile`.

Status parity upstream: **pending verification**. Pengujian pada 16 November 2026 menemukan `quotaDelta` BankAI `5243` untuk response usage `359` token, dan `11233` untuk `1615` token. Formula billing pelanggan sekarang memakai `tokens_billed × markup Rexu / 1.000`, tetapi billing tetap dimatikan sampai formula biaya upstream diverifikasi.

Untuk smoke test, model `deepseek-v4.1-flash` diaktifkan pada `1x`. Ubah lewat admin:

```bash
curl -X PATCH http://localhost:3001/api/admin/models/deepseek-v4.1-flash \
  -H "content-type: application/json" \
  -b cookies.txt \
  -d '{"multiplier":1.25,"isEnabled":true}'
```

## Endpoint publik

```text
GET  /v1/models
POST /v1/chat/completions
GET  /v1/usage
```

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer sk-rxu-..." \
  -H "content-type: application/json" \
  -d '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"Halo"}]}'
```

## Catatan keamanan

- Jangan commit `.env`, `cert/`, `tmp/`, atau file key.
- Raw API key hanya tampil sekali.
- Browser tidak pernah menerima `BANKAI_API_KEY`.
- Phase 1 tidak membuka pemakaian berbayar. `BILLING_ENABLED=true` akan menolak request chat sampai billing engine Phase 2 selesai.
