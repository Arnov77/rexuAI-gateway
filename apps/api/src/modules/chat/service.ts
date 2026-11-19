import { randomUUID } from 'node:crypto';
import { getDb, schema } from '@rexu/db';
import type { ChatCompletionRequest } from '@rexu/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import {
  BankaiError,
  bankai,
  type NormalizedUsage,
  normalizeUsage,
} from '../../providers/bankai.js';
import {
  createUsageRecord,
  estimateReservationCredits,
  markSkippedUsage,
  markTerminalUsage,
  releaseUsage,
  reserveUsage,
  settleUsage,
} from '../billing/service.js';
import { getModelForRequest } from '../models/service.js';

const { messages, conversations } = schema;

export type ChatSource = 'api' | 'playground';

export type ChatInput = {
  userId: string;
  apiKeyId?: string | null;
  source: ChatSource;
  body: ChatCompletionRequest;
  idempotencyKey: string;
  requestId: string;
  conversationId?: string | null;
  headers?: Record<string, string>;
  onComplete?: (content: string, usageLogId: string) => Promise<void> | void;
};

type PreparedChat = {
  logId: string;
  upstreamBody: Record<string, unknown>;
};

function failureStatusFor(error: unknown): 'failed' | 'reconciliation' {
  if (error instanceof BankaiError) {
    return [400, 401, 403, 404, 429].includes(error.status) ? 'failed' : 'reconciliation';
  }
  return 'reconciliation';
}

function errorCodeFor(error: unknown): string {
  if (error instanceof BankaiError) return error.code;
  if (error instanceof Error) return error.name;
  return 'upstream_error';
}

async function prepareChat(input: ChatInput): Promise<PreparedChat> {
  const model = await getModelForRequest(input.body.model);
  if (!model?.isEnabled || !model.isAvailable) {
    throw new AppError(400, 'model_unavailable', 'Model tidak tersedia', {
      type: 'invalid_request_error',
    });
  }
  if (model.multiplierBp == null) {
    throw new AppError(400, 'model_unavailable', 'Model belum memiliki multiplier', {
      type: 'invalid_request_error',
    });
  }

  const { stream: _stream, ...rest } = input.body;
  const upstreamBody = rest as Record<string, unknown>;
  const bankaiMultiplierBp = model.bankaiMultiplierBp ?? 10000;
  const minBlockOverride = model.minBlockOverride ?? null;

  const usageInput = {
    userId: input.userId,
    apiKeyId: input.apiKeyId ?? null,
    conversationId: input.conversationId ?? null,
    source: input.source,
    modelId: model.id,
    idempotencyKey: input.idempotencyKey,
    isStream: Boolean(input.body.stream),
    multiplierBp: model.multiplierBp,
    bankaiMultiplierBp,
    minBlockOverride,
  };

  const logId = env.BILLING_ENABLED
    ? (
        await reserveUsage({
          ...usageInput,
          reserveCredits: await estimateReservationCredits(
            input.body,
            bankaiMultiplierBp,
            minBlockOverride,
          ),
        })
      ).logId
    : await createUsageRecord(usageInput);

  return { logId, upstreamBody };
}

async function finishUsage(params: {
  logId: string;
  usage: NormalizedUsage | null;
  httpStatus: number | null;
  upstreamRequestId: string | null;
  latencyMs: number;
  errorCode: string | null;
  failureStatus?: 'failed' | 'reconciliation';
}): Promise<void> {
  const meta = {
    httpStatus: params.httpStatus,
    upstreamRequestId: params.upstreamRequestId,
    latencyMs: params.latencyMs,
    errorCode: params.errorCode,
  };

  if (params.usage) {
    if (env.BILLING_ENABLED) {
      await settleUsage(params.logId, params.usage, meta);
    } else {
      await markSkippedUsage(params.logId, params.usage, meta);
    }
    return;
  }

  const status = params.failureStatus ?? 'reconciliation';
  const errorCode = params.errorCode ?? (status === 'failed' ? 'upstream_error' : 'usage_missing');
  if (env.BILLING_ENABLED) {
    await releaseUsage(params.logId, status, errorCode, meta);
  } else {
    await markTerminalUsage(params.logId, status, errorCode, meta);
  }
}

function upstreamBodyForNonStream(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy.stream;
  return copy;
}

function contentFromResponse(body: unknown): string {
  const root = body as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = root.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  return '';
}

type CompletionOutcome = {
  body: unknown;
  content: string;
  usage: NormalizedUsage | null;
  httpStatus: number;
  requestId: string | null;
};

type AggregatedStream = {
  id: string | null;
  created: number | null;
  model: string | null;
  finishReason: string | null;
  rawUsage: unknown;
  usage: NormalizedUsage | null;
  text: string;
};

function consumeCompletionFrame(line: string, aggregated: AggregatedStream): void {
  if (!line.startsWith('data:')) return;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return;

  let parsed: {
    id?: unknown;
    created?: unknown;
    model?: unknown;
    usage?: unknown;
    choices?: Array<{
      delta?: { content?: unknown };
      finish_reason?: unknown;
    }>;
  };
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }

  if (aggregated.id == null && typeof parsed.id === 'string') aggregated.id = parsed.id;
  if (aggregated.created == null && typeof parsed.created === 'number') {
    aggregated.created = parsed.created;
  }
  if (aggregated.model == null && typeof parsed.model === 'string') aggregated.model = parsed.model;
  if (parsed.usage) {
    aggregated.rawUsage = parsed.usage;
    aggregated.usage = normalizeUsage(parsed.usage) ?? aggregated.usage;
  }

  const choice = parsed.choices?.[0];
  if (typeof choice?.delta?.content === 'string') aggregated.text += choice.delta.content;
  if (typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0) {
    aggregated.finishReason = choice.finish_reason;
  }
}

async function collectCompletionStream(response: Response): Promise<AggregatedStream> {
  const aggregated: AggregatedStream = {
    id: null,
    created: null,
    model: null,
    finishReason: null,
    rawUsage: null,
    usage: null,
    text: '',
  };

  const reader = response.body?.getReader();
  if (!reader) return aggregated;

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      consumeCompletionFrame(buffer.slice(0, newline).trim(), aggregated);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeCompletionFrame(buffer.trim(), aggregated);

  return aggregated;
}

/**
 * Upstream vendors such as BankAI currently answer non-streaming requests from
 * automated clients with placeholder quotes, while streaming requests return the
 * real completion. Non-streaming callers therefore consume the upstream SSE
 * stream internally and aggregate it back into a regular completion payload.
 */
async function completionViaStream(
  upstreamBody: Record<string, unknown>,
  model: string,
): Promise<CompletionOutcome> {
  const upstream = await bankai.streamChat(upstreamBodyForNonStream(upstreamBody));
  if (!upstream.response.body) {
    throw new AppError(502, 'upstream_error', 'Upstream tidak mengirim stream', {
      type: 'upstream_error',
    });
  }
  const aggregated = await collectCompletionStream(upstream.response);

  return {
    body: {
      id: aggregated.id ?? `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: aggregated.created ?? Math.floor(Date.now() / 1000),
      model: aggregated.model ?? model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: aggregated.text },
          finish_reason: aggregated.finishReason ?? 'stop',
        },
      ],
      ...(aggregated.rawUsage ? { usage: aggregated.rawUsage } : {}),
    },
    content: aggregated.text,
    usage: aggregated.usage,
    httpStatus: upstream.response.status,
    requestId: upstream.requestId,
  };
}

async function completionViaChat(
  upstreamBody: Record<string, unknown>,
): Promise<CompletionOutcome> {
  const result = await bankai.chat(upstreamBodyForNonStream(upstreamBody));
  return {
    body: result.body,
    content: contentFromResponse(result.body),
    usage: normalizeUsage((result.body as { usage?: unknown } | null)?.usage),
    httpStatus: result.status,
    requestId: result.requestId,
  };
}

export async function chatNonStream(input: ChatInput): Promise<{
  body: unknown;
  logId: string;
  requestId: string | null;
  usage: NormalizedUsage | null;
}> {
  const prepared = await prepareChat(input);
  const started = Date.now();

  let outcome: CompletionOutcome;
  try {
    outcome = await completionViaStream(prepared.upstreamBody, input.body.model);
  } catch {
    try {
      outcome = await completionViaChat(prepared.upstreamBody);
    } catch (error) {
      await finishUsage({
        logId: prepared.logId,
        usage: null,
        httpStatus: error instanceof BankaiError ? error.status : null,
        upstreamRequestId: null,
        latencyMs: Date.now() - started,
        errorCode: errorCodeFor(error),
        failureStatus: failureStatusFor(error),
      });
      throw error;
    }
  }

  await finishUsage({
    logId: prepared.logId,
    usage: outcome.usage,
    httpStatus: outcome.httpStatus,
    upstreamRequestId: outcome.requestId,
    latencyMs: Date.now() - started,
    errorCode: null,
  });

  if (outcome.content && input.onComplete) {
    try {
      await input.onComplete(outcome.content, prepared.logId);
    } catch {
      // the upstream response succeeded; persistence can be retried separately
    }
  }

  return {
    body: outcome.body,
    logId: prepared.logId,
    requestId: outcome.requestId,
    usage: outcome.usage,
  };
}

type ParsedSse = {
  done: boolean;
  usage: NormalizedUsage | null;
  text: string;
};

function parseSseLine(line: string, state: ParsedSse): void {
  if (!line.startsWith('data:')) return;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]') {
    state.done = true;
    return;
  }
  try {
    const parsed = JSON.parse(payload) as {
      usage?: unknown;
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    if (parsed.usage) {
      const usage = normalizeUsage(parsed.usage);
      if (usage) state.usage = usage;
    }
    const delta = parsed.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') state.text += delta;
  } catch {
    // ignore malformed keepalive or comment frames
  }
}

export async function chatStream(input: ChatInput, reply: FastifyReply): Promise<void> {
  const prepared = await prepareChat(input);
  const started = Date.now();
  const controller = new AbortController();
  let upstreamRequestId: string | null = null;
  let httpStatus = 200;
  let aborted = false;
  let sawDone = false;
  const state: ParsedSse = { done: false, usage: null, text: '' };

  let upstream: Awaited<ReturnType<typeof bankai.streamChat>>;
  try {
    upstream = await bankai.streamChat(prepared.upstreamBody, controller.signal);
  } catch (error) {
    await finishUsage({
      logId: prepared.logId,
      usage: null,
      httpStatus: error instanceof BankaiError ? error.status : null,
      upstreamRequestId: null,
      latencyMs: Date.now() - started,
      errorCode: errorCodeFor(error),
      failureStatus: failureStatusFor(error),
    });
    throw error;
  }

  if (!upstream.response.body) {
    await finishUsage({
      logId: prepared.logId,
      usage: null,
      httpStatus: upstream.response.status,
      upstreamRequestId: upstream.requestId,
      latencyMs: Date.now() - started,
      errorCode: 'empty_stream',
      failureStatus: 'reconciliation',
    });
    throw new AppError(502, 'upstream_error', 'Upstream tidak mengirim stream', {
      type: 'upstream_error',
    });
  }

  reply.hijack();
  const raw = reply.raw;
  httpStatus = upstream.response.status;
  upstreamRequestId = upstream.requestId;

  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-rexu-request-id': input.requestId,
    'x-rexu-usage-log-id': prepared.logId,
    ...(upstream.requestId ? { 'x-upstream-request-id': upstream.requestId } : {}),
    ...(input.headers ?? {}),
  });

  raw.on('close', () => {
    if (!raw.writableEnded) {
      aborted = true;
      controller.abort();
    }
  });

  const reader = upstream.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalized = false;

  const finalizeOnce = async (params: Parameters<typeof finishUsage>[0]): Promise<void> => {
    if (finalized) return;
    finalized = true;
    await finishUsage(params);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (aborted) break;

      const decoded = decoder.decode(value, { stream: true });
      const doneIndex = decoded.indexOf('data: [DONE]');
      if (doneIndex >= 0) {
        sawDone = true;
        const beforeDone = decoded.slice(0, doneIndex);
        if (beforeDone) raw.write(Buffer.from(beforeDone));
      } else {
        raw.write(Buffer.from(value));
      }

      buffer += decoded;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        parseSseLine(line, state);
      }
    }

    if (buffer.trim()) parseSseLine(buffer.trim(), state);

    await finalizeOnce({
      logId: prepared.logId,
      usage: state.usage,
      httpStatus,
      upstreamRequestId,
      latencyMs: Date.now() - started,
      errorCode: aborted ? 'client_aborted' : state.usage ? null : 'usage_missing',
      failureStatus: aborted ? 'reconciliation' : undefined,
    });

    if (!aborted && state.text && input.onComplete) {
      try {
        await input.onComplete(state.text, prepared.logId);
      } catch {
        // the stream already succeeded; persistence can be reconciled later
      }
    }

    if (!aborted && !raw.writableEnded) {
      if (sawDone) raw.write('data: [DONE]\n\n');
      raw.end();
    }
  } catch (error) {
    if (!aborted && !raw.writableEnded) raw.end();
    await finalizeOnce({
      logId: prepared.logId,
      usage: state.usage,
      httpStatus,
      upstreamRequestId,
      latencyMs: Date.now() - started,
      errorCode: errorCodeFor(error),
      failureStatus: failureStatusFor(error),
    });
    throw error;
  }
}

export function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join(' ')
      .trim();
  }
  return '';
}

export async function appendMessage(params: {
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  modelId?: string | null;
  usageLogId?: string | null;
}): Promise<void> {
  const rows = await getDb()
    .select({ maxSequence: sql<number>`coalesce(max(${messages.sequence}), 0)` })
    .from(messages)
    .where(eq(messages.conversationId, params.conversationId));
  const maxSequence = Number(rows[0]?.maxSequence ?? 0);

  await getDb()
    .insert(messages)
    .values({
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      modelId: params.modelId ?? null,
      usageLogId: params.usageLogId ?? null,
      sequence: maxSequence + 1,
    });

  await getDb()
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, params.conversationId));
}
