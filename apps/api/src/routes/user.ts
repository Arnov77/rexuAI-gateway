import { randomUUID } from 'node:crypto';
import { getDb, schema } from '@rexu/db';
import {
  type ChatCompletionRequest,
  chatCompletionRequestSchema,
  idSchema,
  modelIdSchema,
} from '@rexu/shared';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { apiKeyLastFour, apiKeyPrefix, generateApiKey, hashApiKey } from '../lib/crypto.js';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { bigintString, serializeWallet } from '../lib/serialize.js';
import { getPublicSettings } from '../lib/settings.js';
import { parseWith } from '../lib/validate.js';
import {
  appendMessage,
  chatNonStream,
  chatStream,
  textFromContent,
} from '../modules/chat/service.js';
import { listEnabledModels } from '../modules/models/service.js';
import { listActivePackages } from '../modules/packages/service.js';

const { apiKeys, auditLogs, conversations, messages, transactions, usageLogs, wallets } = schema;

function currentUserId(request: { authUser: { id: string } | null }): string {
  if (!request.authUser) throw unauthorized();
  return request.authUser.id;
}

function idempotencyKey(request: { headers: Record<string, unknown> }): string {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : randomUUID();
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser);

  app.get('/profile', async (request) => {
    const userId = currentUserId(request);
    const [user, walletRows] = await Promise.all([
      getDb()
        .select({
          id: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
          role: schema.users.role,
          status: schema.users.status,
          createdAt: schema.users.createdAt,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1),
      getDb().select().from(wallets).where(eq(wallets.userId, userId)).limit(1),
    ]);
    return { user: user[0] ?? null, wallet: serializeWallet(walletRows[0]) };
  });

  app.get('/models', async () => {
    const settings = await getPublicSettings();
    return { data: await listEnabledModels(settings.publicModelMultipliers) };
  });

  app.get('/packages', async () => {
    const packages = await listActivePackages();
    return {
      data: packages.map(({ id, name, priceIdr, rcAmount, rcPerRupiah }) => ({
        id,
        name,
        priceIdr,
        rcAmount,
        rcPerRupiah,
      })),
    };
  });

  app.get('/keys', async (request) => {
    const userId = currentUserId(request);
    const rows = await getDb()
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastFour: apiKeys.lastFour,
        status: apiKeys.status,
        rateLimitPerMin: apiKeys.rateLimitPerMin,
        creditLimit: apiKeys.creditLimit,
        creditsUsed: apiKeys.creditsUsed,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));

    return {
      data: rows.map(({ creditLimit, creditsUsed, ...row }) => ({
        ...row,
        rcLimit: bigintString(creditLimit),
        rcUsed: bigintString(creditsUsed),
      })),
    };
  });

  app.post('/keys', async (request, reply) => {
    const userId = currentUserId(request);
    const input = parseWith(
      z.object({
        name: z.string().trim().min(1).max(80),
        rateLimitPerMin: z.number().int().min(1).max(10_000).optional(),
      }),
      request.body,
    );

    const rawKey = generateApiKey();
    const [created] = await getDb()
      .insert(apiKeys)
      .values({
        userId,
        name: input.name,
        keyPrefix: apiKeyPrefix(rawKey),
        keyHash: hashApiKey(rawKey),
        lastFour: apiKeyLastFour(rawKey),
        rateLimitPerMin: input.rateLimitPerMin ?? 60,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastFour: apiKeys.lastFour,
        status: apiKeys.status,
        rateLimitPerMin: apiKeys.rateLimitPerMin,
        createdAt: apiKeys.createdAt,
      });

    reply.code(201);
    return { key: rawKey, data: created, notice: 'Simpan key ini. Key tidak ditampilkan lagi.' };
  });

  app.post('/keys/:id/regenerate', async (request) => {
    const userId = currentUserId(request);
    const { id } = parseWith(z.object({ id: idSchema }), request.params);

    return getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: apiKeys.id, name: apiKeys.name, status: apiKeys.status })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
        .limit(1);

      if (!existing) throw notFound('API key tidak ditemukan');
      if (existing.status !== 'active') {
        throw badRequest('API key sudah dicabut dan tidak bisa di-regenerate');
      }

      const rawKey = generateApiKey();
      const keyPrefix = apiKeyPrefix(rawKey);
      const lastFour = apiKeyLastFour(rawKey);

      const [updated] = await tx
        .update(apiKeys)
        .set({ keyPrefix, keyHash: hashApiKey(rawKey), lastFour })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), eq(apiKeys.status, 'active')))
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          lastFour: apiKeys.lastFour,
        });

      if (!updated) throw badRequest('API key sudah dicabut dan tidak bisa di-regenerate');

      await tx.insert(auditLogs).values({
        actorUserId: userId,
        action: 'api_key.regenerate',
        resourceType: 'api_key',
        resourceId: id,
        metadata: { keyPrefix, lastFour },
      });

      return {
        key: rawKey,
        id: updated.id,
        name: updated.name,
        keyPrefix: updated.keyPrefix,
        lastFour: updated.lastFour,
      };
    });
  });

  app.delete('/keys/:id', async (request) => {
    const userId = currentUserId(request);
    const { id } = parseWith(z.object({ id: idSchema }), request.params);
    const [revoked] = await getDb()
      .update(apiKeys)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning({ id: apiKeys.id, status: apiKeys.status });
    if (!revoked) throw notFound('API key tidak ditemukan');
    return { data: revoked };
  });

  app.get('/usage', async (request) => {
    const userId = currentUserId(request);
    const query = parseWith(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        model: modelIdSchema.optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }),
      request.query,
    );

    const conditions = [eq(usageLogs.userId, userId)];
    if (query.model) conditions.push(eq(usageLogs.modelId, query.model));
    if (query.from) conditions.push(gte(usageLogs.createdAt, query.from));
    if (query.to) conditions.push(lte(usageLogs.createdAt, query.to));

    const rows = await getDb()
      .select()
      .from(usageLogs)
      .where(and(...conditions))
      .orderBy(desc(usageLogs.createdAt))
      .limit(query.limit);

    return {
      data: rows.map((row) => ({
        id: row.id,
        modelId: row.modelId,
        source: row.source,
        status: row.status,
        isStream: row.isStream,
        rawTokens: row.rawTokens,
        promptTokens: row.contextTokens,
        completionTokens: row.generationTokens,
        cachedTokens: row.cachedTokens,
        multiplierBp: row.multiplierBp,
        rcDeducted: bigintString(row.creditsDeducted),
        latencyMs: row.latencyMs,
        createdAt: row.createdAt,
      })),
    };
  });

  app.get('/transactions', async (request) => {
    const userId = currentUserId(request);
    const rows = await getDb()
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt))
      .limit(50);
    return {
      data: rows.map((row) => {
        const { tokens, amountIdr, ...rest } = row;
        return {
          ...rest,
          amountIdr: bigintString(amountIdr),
          rc: bigintString(tokens),
        };
      }),
    };
  });

  app.get('/conversations', async (request) => {
    const userId = currentUserId(request);
    const rows = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt))
      .limit(50);
    return { data: rows };
  });

  app.post('/conversations', async (request, reply) => {
    const userId = currentUserId(request);
    const input = parseWith(
      z.object({
        title: z.string().trim().min(1).max(120).optional(),
        modelId: modelIdSchema.optional(),
      }),
      request.body ?? {},
    );

    const [created] = await getDb()
      .insert(conversations)
      .values({
        userId,
        title: input.title ?? 'Percakapan baru',
        defaultModelId: input.modelId ?? null,
      })
      .returning();

    reply.code(201);
    return { data: created };
  });

  app.get('/conversations/:id/messages', async (request) => {
    const userId = currentUserId(request);
    const { id } = parseWith(z.object({ id: idSchema }), request.params);

    const conversationRows = await getDb()
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .limit(1);
    if (!conversationRows[0]) throw notFound('Percakapan tidak ditemukan');

    const rows = await getDb()
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.sequence)
      .limit(300);

    return { data: rows };
  });

  app.post('/playground/chat', async (request, reply) => {
    const userId = currentUserId(request);
    const input = parseWith(
      chatCompletionRequestSchema.extend({
        conversationId: idSchema.optional(),
      }),
      request.body,
    );

    const lastUser = [...input.messages].reverse().find((message) => message.role === 'user');
    if (!lastUser) throw badRequest('Minimal satu pesan user diperlukan');

    let conversationId = input.conversationId;
    if (conversationId) {
      const existing = await getDb()
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
        .limit(1);
      if (!existing[0]) throw notFound('Percakapan tidak ditemukan');
    } else {
      const title = textFromContent(lastUser.content).slice(0, 80) || 'Percakapan baru';
      const [created] = await getDb()
        .insert(conversations)
        .values({ userId, title, defaultModelId: input.model })
        .returning({ id: conversations.id });
      if (!created) throw new Error('failed to create conversation');
      conversationId = created.id;
    }

    await appendMessage({
      conversationId,
      role: 'user',
      content: lastUser.content,
      modelId: input.model,
    });

    const { conversationId: _conversationId, ...chatBody } = input;
    const chatInput = {
      userId,
      source: 'playground' as const,
      body: chatBody as ChatCompletionRequest,
      idempotencyKey: idempotencyKey(request),
      requestId: request.id,
      conversationId,
      headers: { 'x-rexu-conversation-id': conversationId as string },
      onComplete: async (content: string, usageLogId: string) => {
        await appendMessage({
          conversationId: conversationId as string,
          role: 'assistant',
          content,
          modelId: chatBody.model,
          usageLogId,
        });
      },
    };

    if (chatBody.stream) {
      await chatStream(chatInput, reply);
      return reply;
    }

    const result = await chatNonStream(chatInput);
    reply.header('x-rexu-conversation-id', conversationId);
    reply.header('x-rexu-usage-log-id', result.logId);
    if (result.requestId) reply.header('x-upstream-request-id', result.requestId);
    return reply.send(result.body);
  });
}
