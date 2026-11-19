import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../packages/db/src/env.js';

loadEnv();

const baseUrl = (process.env.BANKAI_BASE_URL ?? 'https://bankai.web.id/api').replace(/\/+$/, '');
const apiKey = process.env.BANKAI_API_KEY?.trim() ?? '';
const timeoutMs = Number(process.env.BANKAI_TIMEOUT_MS ?? 120_000);

if (!apiKey) {
  console.error('BANKAI_API_KEY is required');
  process.exit(1);
}

// biome-ignore lint/suspicious/noExplicitAny: upstream JSON is dynamic
type Json = Record<string, any>;
type Check = {
  name: string;
  ok: boolean;
  status?: number;
  detail?: unknown;
};

const checks: Check[] = [];

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

async function request(pathname: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res: Response): Promise<Json> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Json;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function usageSummary(usage: Json | undefined) {
  if (!usage) return null;
  return {
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
    total_tokens: usage.total_tokens ?? null,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? null,
  };
}

function chatBody(model: string, stream: boolean) {
  return {
    model,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    max_tokens: 32,
    temperature: 0,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}

async function postChat(body: Json): Promise<{ res: Response; json: Json }> {
  let res = await request('/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  let json = await readJson(res);

  if (res.status === 400 && body.max_tokens) {
    const fallback = { ...body, max_completion_tokens: body.max_tokens };
    delete fallback.max_tokens;
    res = await request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(fallback),
    });
    json = await readJson(res);
  }

  return { res, json };
}

async function verifyModels(): Promise<string> {
  const res = await request('/v1/models', { method: 'GET' });
  const json = await readJson(res);
  const data = Array.isArray(json.data) ? (json.data as Json[]) : [];
  checks.push({
    name: 'models',
    ok: res.ok && data.length > 0,
    status: res.status,
    detail: {
      count: data.length,
      fields: data[0] ? Object.keys(data[0]).sort() : [],
      sample: data[0]?.id ?? null,
    },
  });

  if (!res.ok || data.length === 0) {
    throw new Error(`model list failed with HTTP ${res.status}`);
  }

  const preferred = process.env.BANKAI_TEST_MODEL;
  const byId = new Map(data.map((m) => [String(m.id), m]));
  const model =
    (preferred && byId.get(preferred)?.id) ||
    byId.get('deepseek-v4.1-flash')?.id ||
    byId.get('auto')?.id ||
    data.find((m) => m.available && m.enabled)?.id ||
    data[0]?.id;

  if (!model) throw new Error('no usable model found');
  return String(model);
}

async function verifyNonStream(model: string): Promise<void> {
  const { res, json } = await postChat(chatBody(model, false));
  const usage = usageSummary(json.usage);
  const content = json.choices?.[0]?.message?.content ?? null;
  checks.push({
    name: 'chat_non_stream',
    ok:
      res.ok && Boolean(usage?.prompt_tokens != null) && Boolean(usage?.completion_tokens != null),
    status: res.status,
    detail: {
      model: json.model ?? null,
      content: typeof content === 'string' ? content.slice(0, 120) : null,
      usage,
      error: res.ok ? null : (json.error ?? json),
    },
  });
}

async function verifyStream(model: string): Promise<void> {
  const body = chatBody(model, true);
  let res = await request('/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (res.status === 400) {
    const fallback = { ...body, max_completion_tokens: body.max_tokens };
    delete fallback.max_tokens;
    res = await request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(fallback),
    });
  }

  if (!res.ok || !res.body) {
    const json = await readJson(res);
    checks.push({
      name: 'chat_stream',
      ok: false,
      status: res.status,
      detail: { error: json.error ?? json },
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunks = 0;
  let done = false;
  let usage: Json | undefined;
  let text = '';

  while (true) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        done = true;
        continue;
      }
      chunks += 1;
      try {
        const parsed = JSON.parse(payload) as Json;
        if (parsed.usage) usage = parsed.usage;
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') text += delta;
      } catch {
        // ignore malformed keepalive chunks
      }
    }
  }

  checks.push({
    name: 'chat_stream',
    ok: done && Boolean(usage?.prompt_tokens != null) && Boolean(usage?.completion_tokens != null),
    status: res.status,
    detail: {
      chunks,
      done,
      content: text.slice(0, 120),
      usage: usageSummary(usage),
    },
  });
}

async function verifyQuota(): Promise<void> {
  const res = await request('/v1/quota', { method: 'GET' });
  const json = await readJson(res);
  checks.push({
    name: 'quota',
    ok: res.ok,
    status: res.status,
    detail: res.ok
      ? {
          keys: Object.keys(json).sort(),
          remainingTokens: json.remainingTokens ?? json.remaining_quota ?? null,
          status: json.status ?? null,
        }
      : { error: json.error ?? json },
  });
}

async function verifyInvalidModel(): Promise<void> {
  const res = await request('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: '__rexu_invalid_model__',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 8,
    }),
  });
  const json = await readJson(res);
  checks.push({
    name: 'invalid_model',
    ok: !res.ok,
    status: res.status,
    detail: { error: json.error ?? json },
  });
}

async function main() {
  const model = await verifyModels();
  console.log(`model: ${model}`);
  await verifyNonStream(model);
  await verifyStream(model);
  await verifyQuota();
  await verifyInvalidModel();

  fs.mkdirSync('tmp', { recursive: true });
  const report = {
    baseUrl,
    checkedAt: new Date().toISOString(),
    model,
    checks,
  };
  fs.writeFileSync(path.join('tmp', 'bankai-verify.json'), JSON.stringify(report, null, 2));

  for (const check of checks) {
    const label = check.ok ? 'PASS' : 'FAIL';
    console.log(`${label} ${check.name}${check.status ? ` HTTP ${check.status}` : ''}`);
    if (!check.ok) console.log(JSON.stringify(check.detail, null, 2));
  }

  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
