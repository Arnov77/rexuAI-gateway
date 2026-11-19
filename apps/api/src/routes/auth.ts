import { hash, verify } from '@node-rs/argon2';
import { getDb, schema } from '@rexu/db';
import { emailSchema, passwordSchema, SETTINGS_KEYS } from '@rexu/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireUser,
  setSessionCookie,
} from '../lib/auth.js';
import { AppError, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { serializeWallet } from '../lib/serialize.js';
import { getSetting } from '../lib/settings.js';
import { parseWith } from '../lib/validate.js';
import { sendRegisterOtp, verifyRegisterOtp } from '../modules/auth/otp.js';

const { users, wallets } = schema;

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80),
  otp: z.string().length(6),
});

const sendOtpSchema = z.object({
  email: emailSchema,
});

// Rate limit in-memory per email (bukan hanya per IP). Cukup untuk satu instance;
// pindahkan ke Redis bila API dijalankan multi-instance.
const EMAIL_RATE_LIMIT_CLEANUP_MS = 5 * 60 * 1000;
const emailRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkEmailRateLimit(
  scope: string,
  email: string,
  maxAttempts: number,
  windowMs: number,
): void {
  const now = Date.now();
  const key = `${scope}:${email.trim().toLowerCase()}`;
  const record = emailRateLimits.get(key);

  if (!record || record.resetAt <= now) {
    emailRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (record.count >= maxAttempts) {
    throw new AppError(429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi nanti.', {
      type: 'rate_limit_error',
    });
  }

  record.count += 1;
}

function resetEmailRateLimit(scope: string, email: string): void {
  emailRateLimits.delete(`${scope}:${email.trim().toLowerCase()}`);
}

const emailRateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of emailRateLimits) {
    if (record.resetAt <= now) emailRateLimits.delete(key);
  }
}, EMAIL_RATE_LIMIT_CLEANUP_MS);
emailRateLimitCleanup.unref();

async function walletFor(userId: string) {
  const rows = await getDb().select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  return serializeWallet(rows[0]);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = parseWith(loginSchema, request.body);
      const email = input.email.toLowerCase();
      checkEmailRateLimit('login', email, 10, 15 * 60 * 1000);

      const rows = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0];
      if (user?.status !== 'active') throw unauthorized('Email atau password salah');

      const valid = await verify(user.passwordHash, input.password);
      if (!valid) throw unauthorized('Email atau password salah');

      const session = await createSession(user.id, request);
      await getDb()
        .update(users)
        .set({ lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      setSessionCookie(reply, session.token, session.expiresAt);
      resetEmailRateLimit('login', email);
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        wallet: await walletFor(user.id),
      };
    },
  );

  app.post('/logout', async (request, reply) => {
    await destroySession(request);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/me', { preHandler: requireUser }, async (request) => {
    const user = request.authUser;
    if (!user) throw unauthorized();
    return {
      user,
      wallet: await walletFor(user.id),
    };
  });

  app.post(
    '/send-otp',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const input = parseWith(sendOtpSchema, request.body);
      const email = input.email.toLowerCase();
      // Maksimal 3 permintaan OTP per email per jam (selain batas per IP).
      checkEmailRateLimit('send-otp', email, 3, 60 * 60 * 1000);
      await sendRegisterOtp(email);
      // Respons generik: jangan bocorkan apakah email sudah terdaftar.
      return { message: 'Jika email valid dan belum terdaftar, kode akan dikirim.' };
    },
  );

  app.post(
    '/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const mode = await getSetting<string>(SETTINGS_KEYS.registrationMode, 'closed');
      if (mode !== 'public') throw forbidden('Pendaftaran publik sedang ditutup');

      const input = parseWith(registerSchema, request.body);
      const email = input.email.toLowerCase();
      // Maksimal 10 percobaan verifikasi OTP per email per jam (lintas kode).
      checkEmailRateLimit('verify-otp', email, 10, 60 * 60 * 1000);

      await verifyRegisterOtp(email, input.otp);

      const existing = await getDb()
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing[0]) throw conflict('Email sudah terdaftar');

      const passwordHash = await hash(input.password, {
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
        outputLen: 32,
      });

      const [created] = await getDb()
        .insert(users)
        .values({
          email,
          passwordHash,
          name: input.name,
          role: 'customer',
          status: 'active',
          emailVerifiedAt: new Date(),
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
        });
      if (!created) throw new Error('failed to create user');

      await getDb().insert(wallets).values({ userId: created.id });
      const session = await createSession(created.id, request);
      setSessionCookie(reply, session.token, session.expiresAt);

      return { user: created, wallet: await walletFor(created.id) };
    },
  );
}
