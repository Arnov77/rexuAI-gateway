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
import { conflict, forbidden, unauthorized } from '../lib/errors.js';
import { serializeWallet } from '../lib/serialize.js';
import { getSetting } from '../lib/settings.js';
import { parseWith } from '../lib/validate.js';

const { users, wallets } = schema;

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80),
});

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
    '/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const mode = await getSetting<string>(SETTINGS_KEYS.registrationMode, 'closed');
      if (mode !== 'public') throw forbidden('Pendaftaran publik sedang ditutup');

      const input = parseWith(registerSchema, request.body);
      const email = input.email.toLowerCase();

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
