import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { closeDb, getDb, loadEnv } from '../packages/db/src/index.js';

loadEnv();

const API_BASE_URL = (
  process.env.API_BASE_URL ??
  process.env.REXU_BASE_URL ??
  'http://localhost:3001'
).replace(/\/+$/, '');
const BANKAI_BASE_URL = (process.env.BANKAI_BASE_URL ?? '').replace(/\/+$/, '');
const BANKAI_API_KEY = process.env.BANKAI_API_KEY?.trim() ?? '';
const BANKAI_QUOTA_PATH = process.env.BANKAI_QUOTA_PATH ?? '/v1/quota';
const TEST_API_KEY = process.env.TEST_API_KEY?.trim() ?? '';
const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? '';

const REQUEST_TIMEOUT_MS = 150_000;
const STREAM_TIMEOUT_MS = 300_000;
const REQUEST_DELAY_MS = 1_000;
const SETTLE_DELAY_MS = 2_000;
const SHADOW_WINDOW_MINUTES = 10;

/** Toleransi 5% untuk overhead BankAI yang tidak predictable. */
const COVERAGE_THRESHOLD = 0.95;

const numberFormatter = new Intl.NumberFormat('id-ID');
const decimalFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

type RequestStatus = 'ok' | 'failed' | 'skipped';

type ResponseUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type PlannedRequest = {
  model: string;
  prompt: string;
  stream: boolean;
};

type TestResult = {
  index: number;
  model: string;
  stream: boolean;
  promptChars: number;
  promptPreview: string;
  status: RequestStatus;
  httpStatus: number | null;
  latencyMs: number;
  requestId: string | null;
  usageLogId: string | null;
  upstreamRequestId: string | null;
  usage: ResponseUsage | null;
  responsePreview: string | null;
  error: string | null;
};

type ShadowRow = {
  id: string;
  model_id: string | null;
  raw_tokens: number | string;
  bankai_multiplier_bp: number | null;
  effective_min_block: number | null;
  credits_deducted: number | string;
  status: string;
  created_at: string | Date;
};

type ModelOverrides = Map<string, number | null>;

type ModelSummary = {
  model: string;
  requests: number;
  rawTokens: number;
  rc: number;
  estimasiToken: number;
  ratio: number | null;
};

type Report = {
  timestamp: string;
  quotaBefore: number;
  quotaAfter: number;
  quotaDelta: number;
  requests: TestResult[];
  shadowBilling: {
    totalRc: number;
    estimasiToken: number;
    rawTokens: number;
    perModel: ModelSummary[];
  };
  result: 'pass' | 'fail';
  coverage: number;
  reasons: string[];
};

const TECHNICAL_TERMS = `
sistem arsitektur protokol endpoint request response payload header cache queue worker
latency throughput konkurensi idempotensi replikasi sharding transaksi konsistensi
database indeks kueri relasi migrasi skema kunci primer sekunder partisi normalisasi
distribusi cluster node failover timeout retry backoff observability metrik tracing log
kontainer orkestrasi deployment pipeline integrasi versi rilis rollback konfigurasi
enkripsi autentikasi otorisasi token sesi izin audit validasi sanitasi batas laju
kompresi serialisasi biner tekstual stream buffer soket koneksi handshake heartbeat
algoritma struktur data pohon graf hash antrean tumpukan rekursi iterasi kompleksitas
`
  .trim()
  .split(/\s+/);

const MODELS = ['deepseek-v4.1-flash', 'kimi-k2.7-code', 'gpt-6-luna', 'glm-5.3'] as const;

const SKIPPABLE_ERROR_CODES = new Set([
  'model_unavailable',
  'model_not_found',
  'not_enabled',
  'model_disabled',
]);

function required(name: string, value: string): string {
  if (!value) {
    console.error(`❌ ${name} tidak ditemukan. Pastikan sudah diisi di .env atau environment.`);
    process.exit(1);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Deterministic pseudo-technical lorem ipsum. Dipakai untuk menguji prompt
 * panjang tanpa mengirim teks yang sama pada dua model.
 */
function buildLongPrompt(seed: number, targetWords = 500): string {
  const sentences: string[] = [];
  let wordCount = 0;
  let state = seed >>> 0;

  function nextRandom(): number {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  }

  while (wordCount < targetWords) {
    const sentenceLength = 12 + Math.floor(nextRandom() * 8);
    const words: string[] = [];
    for (let i = 0; i < sentenceLength && wordCount + words.length < targetWords; i += 1) {
      const term = TECHNICAL_TERMS[Math.floor(nextRandom() * TECHNICAL_TERMS.length)];
      words.push(term ?? 'sistem');
    }
    if (words.length === 0) break;
    const first = words[0] ?? 'sistem';
    words[0] = first.charAt(0).toUpperCase() + first.slice(1);
    wordCount += words.length;
    sentences.push(`${words.join(' ')}.`);
  }

  return `Ringkas dokumen teknis berikut dalam satu paragraf padat.\n\n${sentences.join(' ')}`;
}

function buildTestPlan(): PlannedRequest[] {
  return [
    {
      model: 'deepseek-v4.1-flash',
      prompt: 'Halo, jawab singkat.',
      stream: false,
    },
    {
      model: 'deepseek-v4.1-flash',
      prompt: 'Apa itu API REST? Jelaskan dalam 2 kalimat.',
      stream: false,
    },
    {
      model: 'deepseek-v4.1-flash',
      prompt: buildLongPrompt(11),
      stream: false,
    },
    {
      model: 'kimi-k2.7-code',
      prompt: 'Halo, jawab singkat.',
      stream: false,
    },
    {
      model: 'kimi-k2.7-code',
      prompt: 'Tulis fungsi Python untuk reverse string.',
      stream: false,
    },
    {
      model: 'kimi-k2.7-code',
      prompt: buildLongPrompt(22),
      stream: false,
    },
    {
      model: 'gpt-6-luna',
      prompt: 'Halo, jawab singkat.',
      stream: false,
    },
    {
      model: 'gpt-6-luna',
      prompt: 'Apa perbedaan TCP dan UDP?',
      stream: false,
    },
    {
      model: 'glm-5.3',
      prompt: 'Halo, jawab singkat.',
      stream: false,
    },
    {
      model: 'glm-5.3',
      prompt: 'Jelaskan konsep database indexing.',
      stream: false,
    },
    {
      model: 'deepseek-v4.1-flash',
      prompt: 'Hitung 1+1 dan jelaskan.',
      stream: true,
    },
    {
      model: 'kimi-k2.7-code',
      prompt: 'Tulis hello world dalam Go.',
      stream: true,
    },
  ];
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** Formula minimum block: 2048 x bankai multiplier (basis poin). */
function getEffectiveMinBlock(
  bankaiMultiplierBp: number,
  minBlockOverride: number | null = null,
): number {
  if (minBlockOverride != null && minBlockOverride > 0) return minBlockOverride;
  return Math.floor((2_048 * bankaiMultiplierBp) / 10_000);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function usageFromUnknown(raw: unknown): ResponseUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const promptTokens = numberOrNull(record.prompt_tokens);
  const completionTokens = numberOrNull(record.completion_tokens);
  const totalTokens = numberOrNull(record.total_tokens);
  if (promptTokens == null && completionTokens == null && totalTokens == null) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function usageTokenCount(usage: ResponseUsage | null): number | null {
  if (!usage) return null;
  if (usage.totalTokens != null) return usage.totalTokens;
  if (usage.promptTokens != null || usage.completionTokens != null) {
    return (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  }
  return null;
}

function extractError(bodyText: string): { code: string | null; message: string | null } {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const nested = parsed.error;
    if (typeof nested === 'object' && nested !== null) {
      const record = nested as Record<string, unknown>;
      return {
        code: typeof record.code === 'string' ? record.code : null,
        message: typeof record.message === 'string' ? record.message : null,
      };
    }
    return {
      code: typeof parsed.code === 'string' ? parsed.code : null,
      message: typeof parsed.message === 'string' ? parsed.message : null,
    };
  } catch {
    const message = bodyText.trim().slice(0, 200);
    return { code: null, message: message || null };
  }
}

async function fetchBankaiQuota(): Promise<number> {
  const response = await fetch(`${BANKAI_BASE_URL}${BANKAI_QUOTA_PATH}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${BANKAI_API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} dari ${BANKAI_BASE_URL}${BANKAI_QUOTA_PATH}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const remaining = Number(
    body.remainingTokens ?? body.remaining_tokens ?? body.remaining_quota ?? Number.NaN,
  );
  if (!Number.isFinite(remaining)) {
    throw new Error('Response quota tidak mengandung remainingTokens');
  }
  return remaining;
}

async function consumeSse(
  response: Response,
): Promise<{ usage: ResponseUsage | null; text: string; done: boolean }> {
  if (!response.body) return { usage: null, text: '', done: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: ResponseUsage | null = null;
  let text = '';
  let done = false;

  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);

        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            if (parsed.usage != null) {
              usage = usageFromUnknown(parsed.usage) ?? usage;
            }
            const choices = parsed.choices;
            if (Array.isArray(choices) && choices.length > 0) {
              const choice = choices[0] as Record<string, unknown> | null;
              const delta = choice?.delta;
              if (typeof delta === 'object' && delta !== null) {
                const content = (delta as Record<string, unknown>).content;
                if (typeof content === 'string') text += content;
              }
            }
          } catch {
            // Abaikan keepalive/komentar yang bukan JSON.
          }
        }

        newlineIndex = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { usage, text, done };
}

async function sendTestRequest(index: number, item: PlannedRequest): Promise<TestResult> {
  const started = Date.now();
  const promptPreview = item.prompt.replace(/\s+/g, ' ').slice(0, 80);
  const base: Omit<TestResult, 'status' | 'httpStatus' | 'latencyMs' | 'error'> = {
    index,
    model: item.model,
    stream: item.stream,
    promptChars: item.prompt.length,
    promptPreview,
    requestId: null,
    usageLogId: null,
    upstreamRequestId: null,
    usage: null,
    responsePreview: null,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_API_KEY}`,
        'content-type': 'application/json',
        accept: item.stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify({
        model: item.model,
        messages: [{ role: 'user', content: item.prompt }],
        max_tokens: 256,
        ...(item.stream ? { stream: true } : {}),
      }),
      signal: AbortSignal.timeout(item.stream ? STREAM_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
    });

    Object.assign(base, {
      requestId: response.headers.get('x-request-id') ?? response.headers.get('x-rexu-request-id'),
      usageLogId: response.headers.get('x-rexu-usage-log-id'),
      upstreamRequestId: response.headers.get('x-upstream-request-id'),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      const { code, message } = extractError(bodyText);
      const errorCode = code ?? 'unknown_error';
      const skipped = response.status === 404 || SKIPPABLE_ERROR_CODES.has(errorCode);
      return {
        ...base,
        status: skipped ? 'skipped' : 'failed',
        httpStatus: response.status,
        latencyMs: Date.now() - started,
        error: `HTTP ${response.status} ${errorCode}${message ? ` — ${message}` : ''}`,
      };
    }

    if (item.stream) {
      const streamed = await consumeSse(response);
      return {
        ...base,
        status: 'ok',
        httpStatus: response.status,
        latencyMs: Date.now() - started,
        usage: streamed.usage,
        responsePreview: streamed.text.replace(/\s+/g, ' ').slice(0, 120),
        error: streamed.done ? null : 'stream selesai tanpa [DONE]',
      };
    }

    const bodyText = await response.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return {
        ...base,
        status: 'failed',
        httpStatus: response.status,
        latencyMs: Date.now() - started,
        error: `response bukan JSON: ${bodyText.trim().slice(0, 120)}`,
      };
    }

    const choices = body.choices;
    const firstChoice =
      Array.isArray(choices) && choices.length > 0
        ? (choices[0] as Record<string, unknown> | null)
        : null;
    const message = firstChoice?.message;
    const content =
      typeof message === 'object' && message !== null
        ? (message as Record<string, unknown>).content
        : null;

    return {
      ...base,
      status: 'ok',
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      usage: usageFromUnknown(body.usage),
      responsePreview:
        typeof content === 'string' ? content.replace(/\s+/g, ' ').slice(0, 120) : null,
      error: null,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      status: 'failed',
      httpStatus: null,
      latencyMs: Date.now() - started,
      error: name === 'TimeoutError' ? `timeout setelah ${REQUEST_TIMEOUT_MS}ms` : message,
    };
  }
}

async function fetchShadowRows(): Promise<ShadowRow[]> {
  const result = (await getDb().execute(sql`
    SELECT
      id,
      model_id,
      raw_tokens,
      bankai_multiplier_bp,
      effective_min_block,
      credits_deducted,
      status,
      created_at
    FROM usage_logs
    WHERE status = 'skipped'
      AND credits_deducted > 0
      AND created_at > now() - interval '${sql.raw(`${SHADOW_WINDOW_MINUTES} minutes`)}'
    ORDER BY created_at ASC
  `)) as unknown as { rows: ShadowRow[] };

  return result.rows;
}

async function fetchModelOverrides(): Promise<ModelOverrides> {
  try {
    const result = (await getDb().execute(sql`
      SELECT id, min_block_override FROM models
    `)) as unknown as { rows: Array<{ id: string; min_block_override: number | null }> };
    return new Map(result.rows.map((row) => [row.id, row.min_block_override]));
  } catch {
    // Kolom belum ada (migrasi 0005 belum dijalankan): pakai formula.
    return new Map();
  }
}

function summarizePerModel(rows: ShadowRow[], overrides: ModelOverrides): ModelSummary[] {
  const byModel = new Map<string, ModelSummary>();

  for (const row of rows) {
    const model = row.model_id ?? '(unknown)';
    const rawTokens = Number(row.raw_tokens ?? 0);
    const rc = Number(row.credits_deducted ?? 0);
    const bankaiMultiplierBp = Number(row.bankai_multiplier_bp ?? 10_000);
    const effectiveMinBlock =
      row.effective_min_block ??
      getEffectiveMinBlock(bankaiMultiplierBp, overrides.get(model) ?? null);
    const formulaTokens = Math.floor((rawTokens * bankaiMultiplierBp) / 10_000);
    const estimatedTokens = Math.max(formulaTokens, effectiveMinBlock);

    const current = byModel.get(model) ?? {
      model,
      requests: 0,
      rawTokens: 0,
      rc: 0,
      estimasiToken: 0,
      ratio: null,
    };
    current.requests += 1;
    current.rawTokens += Number.isFinite(rawTokens) ? rawTokens : 0;
    current.rc += Number.isFinite(rc) ? rc : 0;
    current.estimasiToken += Number.isFinite(estimatedTokens) ? estimatedTokens : 0;
    byModel.set(model, current);
  }

  for (const summary of byModel.values()) {
    summary.ratio = summary.rawTokens > 0 ? summary.estimasiToken / summary.rawTokens : null;
  }

  return [...byModel.values()];
}

function visualWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    const wide =
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff);
    width += wide ? 2 : 1;
  }
  return width;
}

const BOX_INNER_WIDTH = 56;
const BOX_LABEL_WIDTH = 26;

function boxLine(label: string, value: string): string {
  const content = `${label.padEnd(BOX_LABEL_WIDTH)}: ${value}`;
  const padding = Math.max(0, BOX_INNER_WIDTH - visualWidth(content));
  return `║ ${content}${' '.repeat(padding)} ║`;
}

function boxText(text: string): string {
  return `║ ${text}${' '.repeat(Math.max(0, BOX_INNER_WIDTH - visualWidth(text)))} ║`;
}

function boxDivider(): string {
  return `╠${'═'.repeat(BOX_INNER_WIDTH + 2)}╣`;
}

function boxTop(): string {
  return `╔${'═'.repeat(BOX_INNER_WIDTH + 2)}╗`;
}

function boxBottom(): string {
  return `╚${'═'.repeat(BOX_INNER_WIDTH + 2)}╝`;
}

function boxTitle(title: string): string {
  const padding = Math.max(0, BOX_INNER_WIDTH - visualWidth(title));
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return `║ ${' '.repeat(left)}${title}${' '.repeat(right)} ║`;
}

function printBox(params: {
  sent: number;
  succeeded: number;
  failedOrSkipped: number;
  totalRc: number;
  estimasiToken: number;
  quotaDelta: number;
  coverage: number;
  pass: boolean;
}): void {
  const gap = params.quotaDelta - params.estimasiToken;
  const gapText = `${gap > 0 ? '+' : ''}${formatNumber(gap)} token`;

  console.log(boxTop());
  console.log(boxTitle('HASIL VERIFIKASI SHADOW BILLING'));
  console.log(boxDivider());
  console.log(boxLine('Request dikirim', String(params.sent)));
  console.log(boxLine('Request berhasil', String(params.succeeded)));
  console.log(boxLine('Request gagal/skip', String(params.failedOrSkipped)));
  console.log(boxDivider());
  console.log(boxText('SHADOW BILLING (Rexu)'));
  console.log(boxLine('Total RC dipotong', `${formatNumber(params.totalRc)} RC`));
  console.log(boxLine('Estimasi token BankAI', `${formatNumber(params.estimasiToken)} token`));
  console.log(boxDivider());
  console.log(boxText('ACTUAL (BankAI)'));
  console.log(boxLine('Token berkurang', `${formatNumber(params.quotaDelta)} token`));
  console.log(boxDivider());
  console.log(boxLine('Selisih (aktual-estimasi)', gapText));
  console.log(boxLine('Rasio coverage', `${decimalFormatter.format(params.coverage)}%`));
  console.log(boxDivider());
  console.log(boxLine('STATUS', params.pass ? '✅ LULUS' : '❌ GAGAL'));
  console.log(boxBottom());
}

function printPerModel(summaries: ModelSummary[]): void {
  if (summaries.length === 0) {
    console.log('\nDetail per model: (tidak ada data shadow billing)');
    return;
  }

  const ordered = [
    ...summaries
      .filter((summary) => (MODELS as readonly string[]).includes(summary.model))
      .sort(
        (a, b) =>
          (MODELS as readonly string[]).indexOf(a.model) -
          (MODELS as readonly string[]).indexOf(b.model),
      ),
    ...summaries.filter((summary) => !(MODELS as readonly string[]).includes(summary.model)),
  ];

  const modelWidth = Math.max(20, ...ordered.map((summary) => summary.model.length));
  const header = [
    'Model'.padEnd(modelWidth),
    'Request'.padStart(7),
    'Total Token'.padStart(11),
    'Shadow RC'.padStart(9),
    'Shadow Token'.padStart(12),
    'Rasio'.padStart(7),
  ].join(' | ');
  const separator = [
    '-'.repeat(modelWidth),
    '-'.repeat(7),
    '-'.repeat(11),
    '-'.repeat(9),
    '-'.repeat(12),
    '-'.repeat(7),
  ].join('-+-');

  console.log('\nDetail per model:');
  console.log(`  ${header}`);
  console.log(`  ${separator}`);
  for (const summary of ordered) {
    const ratio = summary.ratio == null ? '—' : `${decimalFormatter.format(summary.ratio * 100)}%`;
    console.log(
      `  ${[
        summary.model.padEnd(modelWidth),
        String(summary.requests).padStart(7),
        formatNumber(summary.rawTokens).padStart(11),
        `${formatNumber(summary.rc)} RC`.padStart(9),
        formatNumber(summary.estimasiToken).padStart(12),
        ratio.padStart(7),
      ].join(' | ')}`,
    );
  }
  console.log(
    '\n  Rasio = estimasi token BankAI (max(raw × multiplier, min block)) ÷ raw token di usage_logs.',
  );
}

function printVerdict(params: {
  pass: boolean;
  reasons: string[];
  estimasiToken: number;
  quotaDelta: number;
  coverage: number;
}): void {
  if (params.pass) {
    console.log('\n✅ Shadow billing verified. Siap untuk aktifkan billing.');
    console.log('   Jalankan: BILLING_ENABLED=true BILLING_UPSTREAM_PARITY_VERIFIED=true');
    return;
  }

  console.log('\n❌ Shadow billing belum akurat.');
  for (const reason of params.reasons) console.log(`   - ${reason}`);
  console.log(`   Estimasi Rexu: ${formatNumber(params.estimasiToken)} token`);
  console.log(`   Actual BankAI: ${formatNumber(params.quotaDelta)} token`);

  const gap = params.quotaDelta - params.estimasiToken;
  const gapPercent = params.quotaDelta > 0 ? (gap / params.quotaDelta) * 100 : 0;
  console.log(`   Gap: ${formatNumber(gap)} token (${decimalFormatter.format(gapPercent)}%)`);
  console.log('   Periksa formula calculateDeductedCredits.');
}

function writeReportFile(report: Report): string {
  const directory = path.resolve(process.cwd(), 'tmp');
  fs.mkdirSync(directory, { recursive: true });
  const fileTimestamp = report.timestamp.replace(/[:.]/g, '-');
  const filePath = path.join(directory, `shadow-billing-verify-${fileTimestamp}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return filePath;
}

async function main(): Promise<void> {
  required('TEST_API_KEY', TEST_API_KEY);
  required('BANKAI_API_KEY', BANKAI_API_KEY);
  required('BANKAI_BASE_URL', BANKAI_BASE_URL);
  required('DATABASE_URL', DATABASE_URL);

  console.log('🔧 Rexu Shadow Billing Verification');
  console.log(`   API      : ${API_BASE_URL}`);
  console.log(`   Upstream : ${BANKAI_BASE_URL}`);
  console.log(`   Database : ${process.env.DATABASE_URL ? new URL(DATABASE_URL).host : '—'}`);
  if (process.env.BILLING_ENABLED === 'true') {
    console.log(
      '⚠️  BILLING_ENABLED=true — script ini membaca baris status="skipped" (shadow mode).',
    );
    console.log('   Jalankan dengan BILLING_ENABLED=false agar usage_logs terisi shadow billing.');
  }

  // Step 1: quota awal.
  let quotaBefore: number;
  try {
    quotaBefore = await fetchBankaiQuota();
  } catch (error) {
    console.error(
      `❌ Gagal mengambil quota BankAI awal: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`\n📊 Quota BankAI awal: ${formatNumber(quotaBefore)} token`);

  // Step 2: kirim 12 request secara sequential.
  const plan = buildTestPlan();
  const results: TestResult[] = [];
  console.log(`\n🚀 Mengirim ${plan.length} request test ke Rexu (sequential)...`);

  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i];
    if (!item) continue;

    const result = await sendTestRequest(i + 1, item);
    results.push(result);

    const label = `${item.model}${item.stream ? ' (stream)' : ''}`;
    const tokenCount = usageTokenCount(result.usage);
    const tokenText = tokenCount == null ? 'usage n/a' : `${formatNumber(tokenCount)} token`;
    const suffix =
      result.status === 'ok'
        ? `OK (${tokenText})`
        : result.status === 'skipped'
          ? `SKIP (${result.error ?? 'tidak tersedia'})`
          : `FAILED (${result.error ?? 'unknown error'})`;
    console.log(`  [${i + 1}/${plan.length}] ${label} — ${suffix}`);

    if (i < plan.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  // Step 3: beri waktu DB menulis usage_logs.
  console.log(`\n⏳ Menunggu ${SETTLE_DELAY_MS / 1_000} detik agar usage_logs selesai ditulis...`);
  await sleep(SETTLE_DELAY_MS);

  // Step 4: quota sesudah.
  let quotaAfter: number;
  try {
    quotaAfter = await fetchBankaiQuota();
  } catch (error) {
    console.error(
      `❌ Gagal mengambil quota BankAI sesudah: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    return;
  }
  const quotaDelta = quotaBefore - quotaAfter;
  console.log(`📊 Quota BankAI sesudah: ${formatNumber(quotaAfter)} token`);
  console.log(`📉 Quota berkurang: ${formatNumber(quotaDelta)} token`);

  // Step 5: query shadow billing.
  console.log('\n🔍 Mengambil shadow billing dari usage_logs...');
  let recentRows: ShadowRow[];
  try {
    recentRows = await fetchShadowRows();
  } catch (error) {
    console.error(
      `❌ Gagal query usage_logs: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    return;
  }

  const capturedLogIds = new Set(
    results
      .map((result) => result.usageLogId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const rows =
    capturedLogIds.size > 0 ? recentRows.filter((row) => capturedLogIds.has(row.id)) : recentRows;

  if (capturedLogIds.size === 0) {
    console.log(
      '⚠️  Header x-rexu-usage-log-id tidak tertangkap; memakai semua baris skipped 10 menit terakhir.',
    );
  } else {
    console.log(
      `   ${rows.length} baris cocok dari ${capturedLogIds.size} usage log ID yang tertangkap.`,
    );
  }

  const totalRc = rows.reduce((sum, row) => sum + Number(row.credits_deducted ?? 0), 0);
  const rawTokens = rows.reduce((sum, row) => sum + Number(row.raw_tokens ?? 0), 0);
  const overrides = await fetchModelOverrides();
  const perModel = summarizePerModel(rows, overrides);
  const estimasiTokenBankAI = perModel.reduce((sum, summary) => sum + summary.estimasiToken, 0);

  const succeeded = results.filter((result) => result.status === 'ok').length;
  const failedOrSkipped = results.length - succeeded;
  const coverage = quotaDelta > 0 ? (estimasiTokenBankAI / quotaDelta) * 100 : 0;

  const reasons: string[] = [];
  if (succeeded === 0) reasons.push('Tidak ada request yang berhasil.');
  if (rows.length === 0) {
    reasons.push('Tidak ada baris shadow billing (status=skipped, credits_deducted>0).');
  }
  if (quotaDelta <= 0) {
    reasons.push('Quota BankAI tidak berkurang (quotaDelta <= 0); hasil tidak bisa diverifikasi.');
  }
  if (quotaDelta > 0 && estimasiTokenBankAI < quotaDelta * COVERAGE_THRESHOLD) {
    reasons.push(`Estimasi token Rexu di bawah ${COVERAGE_THRESHOLD * 100}% pemakaian BankAI.`);
  }
  const pass = reasons.length === 0;

  // Step 6: laporan.
  console.log('');
  printBox({
    sent: results.length,
    succeeded,
    failedOrSkipped,
    totalRc,
    estimasiToken: estimasiTokenBankAI,
    quotaDelta,
    coverage,
    pass,
  });
  printPerModel(perModel);
  printVerdict({ pass, reasons, estimasiToken: estimasiTokenBankAI, quotaDelta, coverage });

  // Step 7: simpan hasil.
  const report: Report = {
    timestamp: new Date().toISOString(),
    quotaBefore,
    quotaAfter,
    quotaDelta,
    requests: results,
    shadowBilling: {
      totalRc,
      estimasiToken: estimasiTokenBankAI,
      rawTokens,
      perModel,
    },
    result: pass ? 'pass' : 'fail',
    coverage: Number(coverage.toFixed(2)),
    reasons,
  };

  const filePath = writeReportFile(report);
  console.log(`\n💾 Hasil lengkap disimpan ke: ${path.relative(process.cwd(), filePath)}`);

  if (!pass) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
