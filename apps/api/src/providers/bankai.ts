import type { ProviderModel, ProviderUsage } from '@rexu/shared';
import { env } from '../config/env.js';

export type NormalizedUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number;
  cachedTokens: number;
  rawTokens: number | null;
};

export type BankaiErrorBody = {
  status: number;
  code: string;
  type: string;
  message: string;
};

export class BankaiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;

  constructor(body: BankaiErrorBody) {
    super(body.message);
    this.name = 'BankaiError';
    this.status = body.status;
    this.code = body.code;
    this.type = body.type;
  }
}

function authHeaders(): Record<string, string> {
  return {
    [env.BANKAI_AUTH_HEADER]: `${env.BANKAI_AUTH_SCHEME} ${env.BANKAI_API_KEY}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function fetchBankai(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
    signal: combined,
  });
}

function requestIdFrom(res: Response): string | null {
  return (
    res.headers.get('x-request-id') ??
    res.headers.get('request-id') ??
    res.headers.get('cf-ray') ??
    null
  );
}

function parseError(status: number, body: unknown): BankaiError {
  const root = body as Record<string, unknown> | null;
  const nested = root?.error;
  if (typeof nested === 'string') {
    return new BankaiError({
      status,
      code: 'upstream_error',
      type: 'upstream_error',
      message: nested,
    });
  }
  const error = nested as Record<string, unknown> | undefined;
  return new BankaiError({
    status,
    code: typeof error?.code === 'string' ? error.code : 'upstream_error',
    type: typeof error?.type === 'string' ? error.type : 'upstream_error',
    message:
      typeof error?.message === 'string'
        ? error.message
        : `Upstream request failed with HTTP ${status}`,
  });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}

export function normalizeUsage(raw: unknown): NormalizedUsage | null {
  const usage = raw as ProviderUsage | undefined;
  if (!usage) return null;

  const promptTokens = numberOrNull(usage.prompt_tokens);
  const completionTokens = numberOrNull(usage.completion_tokens);
  const totalTokens = numberOrNull(usage.total_tokens);
  const reasoningTokens = numberOrZero(
    usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens,
  );
  const cachedTokens = numberOrZero(
    usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens,
  );

  if (promptTokens == null || completionTokens == null) return null;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,
    cachedTokens,
    rawTokens: promptTokens + completionTokens,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export async function listModels(): Promise<ProviderModel[]> {
  const res = await fetchBankai(env.bankaiModelsUrl, { method: 'GET' }, env.BANKAI_TIMEOUT_MS);
  const body = await readJson(res);
  if (!res.ok) throw parseError(res.status, body);

  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new BankaiError({
      status: 502,
      code: 'invalid_upstream_response',
      type: 'upstream_error',
      message: 'BankAI model list response is not an array',
    });
  }
  return data as ProviderModel[];
}

export async function getQuota(): Promise<{ status: number; body: unknown }> {
  const res = await fetchBankai(env.bankaiQuotaUrl, { method: 'GET' }, env.BANKAI_TIMEOUT_MS);
  const body = await readJson(res);
  if (!res.ok) throw parseError(res.status, body);
  return { status: res.status, body };
}

export async function chat(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown; requestId: string | null }> {
  const res = await fetchBankai(
    env.bankaiChatUrl,
    { method: 'POST', body: JSON.stringify(body) },
    env.BANKAI_TIMEOUT_MS,
    signal,
  );
  const json = await readJson(res);
  if (!res.ok) throw parseError(res.status, json);
  return { status: res.status, body: json, requestId: requestIdFrom(res) };
}

export async function streamChat(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ response: Response; requestId: string | null }> {
  const streamBody = {
    ...body,
    stream: true,
    ...(env.BANKAI_STREAM_USAGE
      ? { stream_options: { ...(body.stream_options as object | undefined), include_usage: true } }
      : {}),
  };

  const response = await fetchBankai(
    env.bankaiChatUrl,
    {
      method: 'POST',
      body: JSON.stringify(streamBody),
      headers: { accept: 'text/event-stream' },
    },
    env.BANKAI_STREAM_TIMEOUT_MS,
    signal,
  );

  if (!response.ok) {
    const json = await readJson(response);
    throw parseError(response.status, json);
  }

  return { response, requestId: requestIdFrom(response) };
}

export const bankai = {
  listModels,
  getQuota,
  chat,
  streamChat,
  normalizeUsage,
};
