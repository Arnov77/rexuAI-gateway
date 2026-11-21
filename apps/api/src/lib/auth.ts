import { getDb, schema } from '@rexu/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import type { ApiKeyAuth, AuthUser } from '../types.js';
import { hashApiKey, hashSessionToken, randomToken } from './crypto.js';
import { AppError, forbidden, unauthorized } from './errors.js';

const { sessions, users, apiKeys } = schema;

const lastUsedUpdates = new Map<string, number>();
const keyWindows = new Map<string, { count: number; resetAt: number }>();

function checkKeyRateLimit(keyId: string, limit: number, reply: FastifyReply): void {
  const now = Date.now();
  if (keyWindows.size > 10_000) {
    for (const [id, window] of keyWindows) {
      if (window.resetAt <= now) keyWindows.delete(id);
    }
  }

  const current = keyWindows.get(keyId);
  if (!current || current.resetAt <= now) {
    keyWindows.set(keyId, { count: 1, resetAt: now + 60_000 });
    return;
  }

  if (current.count >= limit) {
    reply.header('retry-after', Math.ceil((current.resetAt - now) / 1000));
    throw new AppError(429, 'rate_limited', 'Batas request API key tercapai', {
      type: 'rate_limit_error',
    });
  }

  current.count += 1;
}

export async function createSession(
  userId: string,
  request: FastifyRequest,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000);

  await getDb()
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

  return { token, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(env.cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.cookieName, { path: '/' });
}

export async function destroySession(request: FastifyRequest): Promise<void> {
  const token = request.cookies[env.cookieName];
  if (!token) return;
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashSessionToken(token)));
}

/** Cari user dari cookie sesi tanpa melempar error saat belum login. */
export async function resolveUser(request: FastifyRequest): Promise<AuthUser | null> {
  const token = request.cookies[env.cookieName];
  if (!token) return null;

  const rows = await getDb()
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row?.status !== 'active') return null;

  return {
    id: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

export async function requireUser(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const user = await resolveUser(request);
  if (!user) throw unauthorized();
  request.authUser = user;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireUser(request, reply);
  if (request.authUser?.role !== 'admin') throw forbidden();
}

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('API key diperlukan');

  const rawKey = header.slice('Bearer '.length).trim();
  if (!rawKey.startsWith('sk-rxu-')) throw unauthorized('API key tidak valid');

  const rows = await getDb()
    .select({
      keyId: apiKeys.id,
      userId: apiKeys.userId,
      name: apiKeys.name,
      status: apiKeys.status,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      creditLimit: apiKeys.creditLimit,
      creditsUsed: apiKeys.creditsUsed,
      lastUsedAt: apiKeys.lastUsedAt,
      userStatus: users.status,
    })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(eq(apiKeys.keyHash, hashApiKey(rawKey)))
    .limit(1);

  const row = rows[0];
  if (row?.status !== 'active' || row.userStatus !== 'active') {
    throw unauthorized('API key tidak valid atau sudah dicabut');
  }

  checkKeyRateLimit(row.keyId, row.rateLimitPerMin, reply);

  request.apiKeyAuth = {
    id: row.keyId,
    userId: row.userId,
    name: row.name,
    rateLimitPerMin: row.rateLimitPerMin,
    creditLimit: row.creditLimit,
    creditsUsed: row.creditsUsed,
  };

  const now = Date.now();
  const lastTouch = lastUsedUpdates.get(row.keyId) ?? 0;
  if (!row.lastUsedAt || now - lastTouch > 60_000) {
    lastUsedUpdates.set(row.keyId, now);
    void getDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.keyId));
  }
}

export type { ApiKeyAuth, AuthUser };
