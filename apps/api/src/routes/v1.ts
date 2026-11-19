import { randomUUID } from 'node:crypto';
import { getDb, schema } from '@rexu/db';
import { type ChatCompletionRequest, chatCompletionRequestSchema } from '@rexu/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireApiKey } from '../lib/auth.js';
import { AppError, unauthorized } from '../lib/errors.js';
import { parseWith } from '../lib/validate.js';
import { getWalletSnapshot } from '../modules/billing/service.js';
import { chatNonStream, chatStream } from '../modules/chat/service.js';
import { listEnabledModels } from '../modules/models/service.js';

const { usageLogs } = schema;

function apiKeyContext(request: FastifyRequest) {
  if (!request.apiKeyAuth) throw unauthorized();
  return request.apiKeyAuth;
}

function idempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : randomUUID();
}

function checkCreditLimit(request: FastifyRequest): void {
  const key = apiKeyContext(request);
  if (key.creditLimit != null && key.creditsUsed >= key.creditLimit) {
    throw new AppError(429, 'insufficient_quota', 'Batas penggunaan API key tercapai', {
      type: 'insufficient_quota',
    });
  }
}

export async function v1Routes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireApiKey);

  app.get('/models', async () => {
    const models = await listEnabledModels(true);
    return {
      object: 'list',
      data: models.map((model) => ({
        id: model.id,
        object: 'model',
        created: Math.floor(new Date(model.createdAt).getTime() / 1000),
        owned_by: model.provider,
        vision: model.vision,
        streaming: model.streaming,
        rexu: {
          displayName: model.displayName,
          multiplier: model.multiplier,
          multiplierBp: model.multiplierBp,
          vision: model.vision,
          streaming: model.streaming,
        },
      })),
    };
  });

  app.post('/chat/completions', async (request, reply) => {
    const key = apiKeyContext(request);
    checkCreditLimit(request);

    const body = parseWith(chatCompletionRequestSchema, request.body) as ChatCompletionRequest;
    const wallet = await getWalletSnapshot(key.userId);
    const quotaRemaining = wallet?.available ?? '0';
    const input = {
      userId: key.userId,
      apiKeyId: key.id,
      source: 'api' as const,
      body,
      idempotencyKey: idempotencyKey(request),
      requestId: request.id,
      headers: { 'x-quota-remaining': quotaRemaining },
    };

    if (body.stream) {
      await chatStream(input, reply);
      return reply;
    }

    const result = await chatNonStream(input);
    reply.header('x-quota-remaining', quotaRemaining);
    reply.header('x-rexu-usage-log-id', result.logId);
    if (result.requestId) reply.header('x-upstream-request-id', result.requestId);
    return reply.send(result.body);
  });

  app.get('/usage', async (request) => {
    const key = apiKeyContext(request);
    const query = parseWith(
      z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }),
      request.query,
    );

    const conditions = [eq(usageLogs.apiKeyId, key.id)];
    if (query.from) conditions.push(gte(usageLogs.createdAt, query.from));
    if (query.to) conditions.push(lte(usageLogs.createdAt, query.to));

    const rows = await getDb()
      .select({
        modelId: usageLogs.modelId,
        requests: sql<number>`count(*)::int`,
        rawTokens: sql<number>`coalesce(sum(${usageLogs.rawTokens}), 0)::bigint`,
        rcDeducted: sql<number>`coalesce(sum(${usageLogs.creditsDeducted}), 0)::bigint`,
      })
      .from(usageLogs)
      .where(and(...conditions))
      .groupBy(usageLogs.modelId);

    const totals = rows.reduce(
      (acc, row) => ({
        requests: acc.requests + Number(row.requests),
        rawTokens: acc.rawTokens + Number(row.rawTokens),
        rcDeducted: acc.rcDeducted + Number(row.rcDeducted),
      }),
      { requests: 0, rawTokens: 0, rcDeducted: 0 },
    );

    return {
      object: 'usage',
      key: { id: key.id, name: key.name },
      period: {
        from: query.from?.toISOString() ?? null,
        to: query.to?.toISOString() ?? null,
      },
      totals,
      by_model: rows.map((row) => ({
        model: row.modelId,
        requests: Number(row.requests),
        raw_tokens: Number(row.rawTokens),
        rc_deducted: Number(row.rcDeducted),
      })),
    };
  });
}
