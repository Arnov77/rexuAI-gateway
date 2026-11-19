import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../packages/db/src/env.js';

loadEnv();

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_BILLING_TESTS !== 'true') {
  console.error('Set ALLOW_BILLING_TESTS=true and do not run this against production');
  process.exit(1);
}
if (process.env.BILLING_ENABLED === 'true') {
  console.error('Keep BILLING_ENABLED=false during measurement');
  process.exit(1);
}

const baseUrl = (process.env.BANKAI_BASE_URL ?? 'https://bankai.web.id/api').replace(/\/+$/, '');
const apiKey = process.env.BANKAI_API_KEY;
if (!apiKey) throw new Error('BANKAI_API_KEY is required');

const models = [
  { id: 'kimi-k2.7-code', multiplier: 1 },
  { id: 'glm-5.3', multiplier: 2 },
  { id: 'deepseek-v4.1-flash', multiplier: 2.56 },
  { id: 'gpt-6-luna', multiplier: 8 },
  { id: 'gemini-4-argon', multiplier: 60 },
];

type Variant = {
  key: 'short' | 'long_prompt' | 'long_output';
  prompt: string;
  maxTokens: number;
};

function promptId(model: string, variant: string, repeat: number): string {
  return createHash('sha256').update(`${model}:${variant}:${repeat}`).digest('hex').slice(0, 10);
}

function variantsFor(model: string, repeat: number): Variant[] {
  const shortId = promptId(model, 'short', repeat);
  const longId = promptId(model, 'long_prompt', repeat);
  const longOutputId = promptId(model, 'long_output', repeat);
  const context = 'alpha beta gamma delta epsilon zeta eta theta '.repeat(150);

  return [
    {
      key: 'short',
      prompt: `Kembalikan hanya angka 1 sampai 10 dipisahkan koma. Tanpa penjelasan. ID unik: ${shortId}`,
      maxTokens: 64,
    },
    {
      key: 'long_prompt',
      prompt: `Kembalikan hanya angka 1 sampai 10 dipisahkan koma. Tanpa penjelasan. Abaikan konteks berikut. Konteks: ${context} ID unik: ${longId}`,
      maxTokens: 64,
    },
    {
      key: 'long_output',
      prompt: `Kembalikan hanya angka 1 sampai 60 dipisahkan koma. Tanpa penjelasan. ID unik: ${longOutputId}`,
      maxTokens: 200,
    },
  ];
}

type Quota = {
  remainingTokens: string | number;
  usage?: {
    prompt_tokens?: string | number;
    completion_tokens?: string | number;
    total_tokens?: string | number;
    cached_tokens?: string | number;
    requests?: number;
  };
};

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number };
};

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function quota(): Promise<Quota> {
  const response = await fetch(`${baseUrl}/v1/quota`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`quota failed with HTTP ${response.status}`);
  return (await response.json()) as Quota;
}

function usageSummary(usage: Usage | undefined) {
  return {
    prompt_tokens: num(usage?.prompt_tokens),
    completion_tokens: num(usage?.completion_tokens),
    total_tokens: num(usage?.total_tokens),
    cached_tokens: num(usage?.prompt_tokens_details?.cached_tokens),
    reasoning_tokens: num(usage?.completion_tokens_details?.reasoning_tokens),
  };
}

async function request(model: string, variant: Variant, repeat: number) {
  const body = {
    model,
    messages: [{ role: 'user', content: variant.prompt }],
    max_tokens: variant.maxTokens,
    temperature: 0,
    stream: false,
  };

  const started = Date.now();
  const before = await quota();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const rawText = await response.text();
  let parsed: {
    usage?: Usage;
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; code?: string; type?: string };
  } | null = null;
  try {
    parsed = rawText ? (JSON.parse(rawText) as typeof parsed) : null;
  } catch {
    parsed = null;
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const after = await quota();

  const usage = usageSummary(parsed?.usage);
  const quotaDelta = num(before.remainingTokens) - num(after.remainingTokens);
  const dashboardDelta = num(after.usage?.total_tokens) - num(before.usage?.total_tokens);
  const catalogMultiplier = models.find((item) => item.id === model)?.multiplier ?? 0;
  const catalogExpected = Math.ceil(usage.total_tokens * catalogMultiplier);
  const catalogExpectedSplit =
    Math.ceil(usage.prompt_tokens * catalogMultiplier) +
    Math.ceil(usage.completion_tokens * catalogMultiplier);

  return {
    model,
    catalogMultiplier,
    variant: variant.key,
    repeat,
    promptChars: variant.prompt.length,
    maxTokens: variant.maxTokens,
    httpStatus: response.status,
    elapsedMs: Date.now() - started,
    usage,
    contentPreview: parsed?.choices?.[0]?.message?.content?.slice(0, 120) ?? null,
    error: parsed?.error ?? null,
    quotaBefore: {
      remainingTokens: num(before.remainingTokens),
      usageTotalTokens: num(before.usage?.total_tokens),
      requests: num(before.usage?.requests),
    },
    quotaAfter: {
      remainingTokens: num(after.remainingTokens),
      usageTotalTokens: num(after.usage?.total_tokens),
      requests: num(after.usage?.requests),
    },
    quotaDelta,
    dashboardDelta,
    consistent: quotaDelta === dashboardDelta,
    catalogExpected,
    catalogExpectedSplit,
    ratioActualRaw: usage.total_tokens > 0 ? quotaDelta / usage.total_tokens : null,
    ratioToCatalog: catalogExpected > 0 ? Number((quotaDelta / catalogExpected).toFixed(4)) : null,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function markdownReport(payload: {
  checkedAt: string;
  idleCheck: { before: number; after: number; stable: boolean };
  results: Awaited<ReturnType<typeof request>>[];
  summary: unknown;
}) {
  const rows = payload.results
    .map(
      (row) =>
        `| ${row.model} | ${row.variant} | ${row.repeat} | ${row.promptChars} | ${row.usage.prompt_tokens} | ${row.usage.completion_tokens} | ${row.usage.total_tokens} | ${row.usage.cached_tokens} | ${row.usage.reasoning_tokens} | ${row.quotaDelta} | ${row.dashboardDelta} | ${row.catalogMultiplier}x | ${row.catalogExpected} | ${row.ratioActualRaw?.toFixed(3) ?? '-'} | ${row.ratioToCatalog ?? '-'} |`,
    )
    .join('\n');

  const summaryRows = Array.isArray(payload.summary)
    ? payload.summary
        .map(
          (item: {
            model: string;
            variant: string;
            multiplier: number;
            avgPrompt: number;
            avgCompletion: number;
            avgTotal: number;
            avgActual: number;
            avgCatalog: number;
            avgRatio: number | null;
            avgCatalogRatio: number | null;
            consistent: boolean;
          }) =>
            `| ${item.model} | ${item.variant} | ${item.multiplier}x | ${item.avgPrompt.toFixed(1)} | ${item.avgCompletion.toFixed(1)} | ${item.avgTotal.toFixed(1)} | ${item.avgActual.toFixed(1)} | ${item.avgCatalog.toFixed(1)} | ${item.avgRatio?.toFixed(3) ?? '-'} | ${item.avgCatalogRatio ?? '-'} | ${item.consistent ? 'ya' : 'tidak'} |`,
        )
        .join('\n')
    : '';

  const facts = [
    `Quota measurement idle stabil: ${payload.idleCheck.stable ? 'ya' : 'tidak'}.`,
    'Setiap request diukur dengan selisih `remainingTokens` sebelum dan sesudah request.',
    'Selisih `usage.total_tokens` pada endpoint quota juga dicatat sebagai pembanding.',
    'Multiplier katalog yang dipakai: kimi-k2.7-code 1x, glm-5.3 2x, deepseek-v4.1-flash 2.56x, gpt-6-luna 8x, gemini-4-argon 60x.',
  ];

  const observations = payload.results
    .filter((row) => row.httpStatus === 200)
    .map((row) => {
      const arrow = row.quotaDelta > row.catalogExpected ? 'lebih tinggi' : 'tidak lebih tinggi';
      return `- ${row.model} / ${row.variant} / repeat ${row.repeat}: actual ${row.quotaDelta}, katalog ${row.catalogMultiplier}x mengharapkan ${row.catalogExpected}, actual ${arrow}.`;
    })
    .slice(0, 30);

  return `# BankAI Multiplier Measurement

Tanggal: ${payload.checkedAt}

Status: **hasil pengukuran terkontrol**. Dokumen ini tidak menetapkan formula final.

## Metode

- Lima model diuji: kimi-k2.7-code, glm-5.3, deepseek-v4.1-flash, gpt-6-luna, gemini-4-argon.
- Tiga varian prompt per model: short, long_prompt, dan long_output.
- Dua pengulangan per varian.
- Prompt memakai instruksi output yang sama dan ID unik berdurasi tetap untuk mengurangi cache.
- Setiap request membaca quota sebelum dan sesudah request, lalu menunggu 1,5 detik.
- Tidak ada request Rexu selama pengukuran. API Rexu dihentikan sementara.
- \`BILLING_ENABLED\` tetap \`false\`.

## Fakta

${facts.map((fact) => `- ${fact}`).join('\n')}

## Data per request

| Model | Varian | Repeat | Prompt chars | Prompt tokens | Completion tokens | Total tokens | Cached | Reasoning | Quota delta | Dashboard delta | Katalog | Expected katalog | Actual/raw | Actual/expected |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

## Ringkasan per model dan varian

| Model | Varian | Multiplier | Avg prompt | Avg completion | Avg total | Avg actual | Avg expected | Actual/raw | Actual/expected | Konsisten |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
${summaryRows}

## Observasi

${observations.join('\n')}

## Hipotesis

Hipotesis di bawah ini belum diverifikasi dan tidak boleh dipakai sebagai formula billing.

- Katalog multiplier tidak otomatis sama dengan rasio \`quotaDelta / total_tokens\`.
- Perbedaan antara request pendek dan panjang dapat menunjukkan biaya minimum, pembulatan, atau faktor input tambahan.
- Perbedaan antara output pendek dan output panjang dapat menunjukkan weighting output, tetapi data dua pengulangan belum cukup untuk memisahkan efek tokenizer dan cache.
- Nilai cached token dapat mengubah biaya efektif jika upstream memberi harga berbeda untuk token cache.

## Belum terverifikasi

- Formula resmi BankAI.
- Unit internal \`remainingTokens\`.
- Ada atau tidaknya biaya minimum per request.
- Weighting input dan output secara terpisah.
- Perlakuan cached token dan reasoning token.
- Apakah multiplier katalog berlaku sebelum atau sesudah pembulatan.
- Apakah model dengan nama yang sama memakai provider upstream yang sama.

## Kesimpulan sementara

Data ini cukup untuk menolak asumsi bahwa billing upstream sama dengan \`ceil((prompt_tokens + completion_tokens) * multiplier_katalog)\`. Data belum cukup untuk menetapkan formula pengganti. \`BILLING_ENABLED\` tetap \`false\`.
`;
}

async function main() {
  const idleBefore = await quota();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const idleAfter = await quota();
  const idleBeforeRemaining = num(idleBefore.remainingTokens);
  const idleAfterRemaining = num(idleAfter.remainingTokens);
  const stable = idleBeforeRemaining === idleAfterRemaining;
  if (!stable) {
    throw new Error(
      `Quota berubah saat idle (${idleBeforeRemaining} -> ${idleAfterRemaining}). Ada request lain; pengukuran dibatalkan.`,
    );
  }

  const results: Awaited<ReturnType<typeof request>>[] = [];
  for (const model of models) {
    for (let repeat = 1; repeat <= 2; repeat += 1) {
      for (const variant of variantsFor(model.id, repeat)) {
        console.log(`measure ${model.id} ${variant.key} repeat ${repeat}`);
        try {
          results.push(await request(model.id, variant, repeat));
        } catch (error) {
          results.push({
            model: model.id,
            catalogMultiplier: model.multiplier,
            variant: variant.key,
            repeat,
            promptChars: variant.prompt.length,
            maxTokens: variant.maxTokens,
            httpStatus: 0,
            elapsedMs: 0,
            usage: usageSummary(undefined),
            contentPreview: null,
            error: { message: error instanceof Error ? error.message : String(error) },
            quotaBefore: { remainingTokens: 0, usageTotalTokens: 0, requests: 0 },
            quotaAfter: { remainingTokens: 0, usageTotalTokens: 0, requests: 0 },
            quotaDelta: 0,
            dashboardDelta: 0,
            consistent: false,
            catalogExpected: 0,
            catalogExpectedSplit: 0,
            ratioActualRaw: null,
            ratioToCatalog: null,
          });
        }
        fs.mkdirSync('tmp', { recursive: true });
        fs.writeFileSync(
          path.join('tmp', 'bankai-multiplier-measurements.partial.json'),
          JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  const summary = models.flatMap((model) =>
    ['short', 'long_prompt', 'long_output'].map((variant) => {
      const rows = results.filter(
        (row) => row.model === model.id && row.variant === variant && row.httpStatus === 200,
      );
      return {
        model: model.id,
        variant,
        multiplier: model.multiplier,
        avgPrompt: average(rows.map((row) => row.usage.prompt_tokens)) ?? 0,
        avgCompletion: average(rows.map((row) => row.usage.completion_tokens)) ?? 0,
        avgTotal: average(rows.map((row) => row.usage.total_tokens)) ?? 0,
        avgActual: average(rows.map((row) => row.quotaDelta)) ?? 0,
        avgCatalog: average(rows.map((row) => row.catalogExpected)) ?? 0,
        avgRatio: average(rows.map((row) => row.ratioActualRaw ?? 0)),
        avgCatalogRatio: average(rows.map((row) => row.ratioToCatalog ?? 0)),
        consistent: rows.every((row) => row.consistent),
      };
    }),
  );

  const payload = {
    checkedAt: new Date().toISOString(),
    billingEnabled: process.env.BILLING_ENABLED === 'true',
    idleCheck: {
      before: idleBeforeRemaining,
      after: idleAfterRemaining,
      stable,
    },
    results,
    summary,
  };

  fs.mkdirSync('tmp', { recursive: true });
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync(
    path.join('tmp', 'bankai-multiplier-measurements.json'),
    JSON.stringify(payload, null, 2),
  );
  fs.writeFileSync(path.join('docs', 'bankai-multiplier-report.md'), markdownReport(payload));

  console.log('measurement complete');
  console.log('json: tmp/bankai-multiplier-measurements.json');
  console.log('report: docs/bankai-multiplier-report.md');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
