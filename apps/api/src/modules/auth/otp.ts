import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { getDb, schema } from '@rexu/db';
import { and, desc, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm';
import { sendEmail } from '../../lib/email.js';
import { AppError, badRequest } from '../../lib/errors.js';

const { emailVerifications, users } = schema;

const OTP_TYPE = 'register';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_DAILY_QUOTA = 10;

const OTP_HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

function rateLimited(message: string): AppError {
  return new AppError(429, 'rate_limited', message, { type: 'rate_limit_error' });
}

function generateOtp(): string {
  return String(randomInt(100_000, 1_000_000));
}

/** Generate OTP registrasi, simpan hash-nya, lalu kirim ke email. */
export async function sendRegisterOtp(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const db = getDb();

  // Jangan bocorkan status pendaftaran: email yang sudah terdaftar tidak dikirimi
  // OTP, tetapi pemanggil tetap mendapat respons sukses yang sama.
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  if (existingUser) return;

  // Kuota harian per email: maksimal 10 OTP per hari. Diam-diam berhenti agar
  // penyerang tidak bisa memakai kuota untuk menebak email terdaftar.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [todayCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.email, normalized),
        eq(emailVerifications.type, OTP_TYPE),
        gte(emailVerifications.createdAt, todayStart),
      ),
    );
  if (Number(todayCount?.count ?? 0) >= OTP_DAILY_QUOTA) return;

  const [lastOtp] = await db
    .select({ createdAt: emailVerifications.createdAt })
    .from(emailVerifications)
    .where(and(eq(emailVerifications.email, normalized), eq(emailVerifications.type, OTP_TYPE)))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);

  // Cooldown juga diam-diam: mengembalikan 429 di sini akan membedakan email
  // terdaftar (selalu sukses) dari email baru (kena cooldown).
  if (lastOtp && Date.now() - lastOtp.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) return;

  const otp = generateOtp();
  const otpHash = await hash(otp, OTP_HASH_OPTIONS);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // Baris OTP lama sengaja tidak dihapus: verifikasi selalu memakai baris
  // terbaru, dan kuota harian di atas butuh riwayat pengiriman hari ini.
  const [created] = await db
    .insert(emailVerifications)
    .values({
      email: normalized,
      otp: otpHash,
      type: OTP_TYPE,
      expiresAt,
    })
    .returning({ id: emailVerifications.id });

  try {
    await sendOtpEmail(normalized, otp);
  } catch (error) {
    // Hapus baris kalau email gagal terkirim agar tidak dihitung kuota harian.
    if (created) {
      await db.delete(emailVerifications).where(eq(emailVerifications.id, created.id));
    }
    console.error('[otp] gagal mengirim email verifikasi', error);
    throw new AppError(
      502,
      'email_failed',
      'Gagal mengirim kode verifikasi. Coba lagi beberapa saat lagi.',
      { type: 'server_error' },
    );
  }
}

export async function sendOtpEmail(email: string, otp: string): Promise<void> {
  const html = `<div style="font-family: 'Courier New', monospace; max-width: 480px; margin: 0 auto; background: #0f0f0d; color: #f0ede6; padding: 40px 32px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px; letter-spacing: -0.04em;">
      rexu<span style="color: #c8573a;">.</span>
    </h1>
    <p style="font-size: 13px; color: #8a8780; margin: 0 0 32px;">
      AI gateway
    </p>
    <p style="font-size: 15px; margin: 0 0 24px; color: #f0ede6;">
      Gunakan kode ini untuk verifikasi email kamu:
    </p>
    <div style="background: #1a1a18; border: 1px solid #333330; padding: 24px; text-align: center; margin: 0 0 24px;">
      <span style="font-size: 36px; font-weight: 700; letter-spacing: 0.15em; color: #f0ede6;">
        ${otp}
      </span>
    </div>
    <p style="font-size: 13px; color: #8a8780; margin: 0 0 8px;">
      Kode berlaku selama <strong style="color: #f0ede6;">10 menit</strong>.
    </p>
    <p style="font-size: 13px; color: #8a8780; margin: 0;">
      Jika kamu tidak meminta kode ini, abaikan email ini.
    </p>
  </div>`;

  const text = `Kode verifikasi Rexu kamu: ${otp}
Berlaku 10 menit.
Jika tidak merasa meminta kode ini, abaikan email ini.`;

  await sendEmail({
    to: email,
    subject: `Kode verifikasi Rexu: ${otp}`,
    html,
    text,
  });
}

/** Validasi OTP registrasi. Mengembalikan true jika cocok, melempar error jika tidak. */
export async function verifyRegisterOtp(email: string, otp: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const db = getDb();

  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.email, normalized),
        eq(emailVerifications.type, OTP_TYPE),
        isNull(emailVerifications.usedAt),
        gt(emailVerifications.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);

  if (!row) throw badRequest('Kode tidak valid atau sudah kedaluwarsa');

  // Klaim satu slot percobaan secara atomik SEBELUM hashing Argon2. UPDATE ini
  // mengunci baris, sehingga permintaan paralel tidak bisa melewati batas 5.
  const updated = await db
    .update(emailVerifications)
    .set({ attempts: sql`${emailVerifications.attempts} + 1` })
    .where(
      and(
        eq(emailVerifications.id, row.id),
        lt(emailVerifications.attempts, OTP_MAX_ATTEMPTS),
        isNull(emailVerifications.usedAt),
        gt(emailVerifications.expiresAt, new Date()),
      ),
    )
    .returning({ attempts: emailVerifications.attempts });

  if (!updated.length) {
    throw rateLimited('Terlalu banyak percobaan. Minta kode baru.');
  }

  let matches = false;
  try {
    matches = await verify(row.otp, otp);
  } catch {
    matches = false;
  }

  if (!matches) {
    throw badRequest('Kode tidak valid');
  }

  // Klaim OTP hanya sekali, meskipun ada dua verifikasi valid yang berbarengan.
  const claimed = await db
    .update(emailVerifications)
    .set({ usedAt: new Date() })
    .where(and(eq(emailVerifications.id, row.id), isNull(emailVerifications.usedAt)))
    .returning({ id: emailVerifications.id });

  if (!claimed.length) {
    throw badRequest('Kode tidak valid atau sudah kedaluwarsa');
  }

  return true;
}
