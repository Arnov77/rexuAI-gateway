import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, like } from 'drizzle-orm';
import {
  apiKeyLastFour,
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
} from '../apps/api/src/lib/crypto.js';
import { closeDb, getDb, loadEnv, schema } from '../packages/db/src/index.js';

loadEnv();

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_BILLING_TESTS !== 'true') {
  console.error('Set ALLOW_BILLING_TESTS=true and do not run this against production');
  process.exit(1);
}
if (process.env.BILLING_ENABLED === 'true') {
  console.error('Keep BILLING_ENABLED=false while upstream billing parity is unverified');
  process.exit(1);
}

const baseUrl = (process.env.BANKAI_BASE_URL ?? 'https://bankai.web.id/api').replace(/\/+$/, '');
const bankaiKey = process.env.BANKAI_API_KEY;
const rexuBase = (process.env.REXU_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const { users, wallets, apiKeys } = schema;

if (!bankaiKey) throw new Error('BANKAI_API_KEY is required');

type Quota = {
  remainingTokens: string | number;
  usage?: {
    total_tokens?: string | number;
    prompt_tokens?: string | number;
    completion_tokens?: string | number;
    requests?: number;
  };
};

async function quota(): Promise<Quota> {
  const response = await fetch(`${baseUrl}/v1/quota`, {
    headers: { authorization: `Bearer ${bankaiKey}` },
  });
  if (!response.ok) throw new Error(`quota failed with HTTP ${response.status}`);
  return (await response.json()) as Quota;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function directRequest(label: string, model: string, content: string) {
  const before = await quota();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bankaiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_tokens: 8,
      temperature: 0,
    }),
  });
  const body = (await response.json()) as {
    usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  };
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const after = await quota();

  const quotaDelta = num(before.remainingTokens) - num(after.remainingTokens);
  const dashboardDelta = num(after.usage?.total_tokens) - num(before.usage?.total_tokens);
  const responseTotal = num(body.usage?.total_tokens);
  return {
    label,
    model,
    promptChars: content.length,
    httpStatus: response.status,
    responseUsage: body.usage ?? null,
    quotaDelta,
    dashboardDelta,
    ratio: responseTotal > 0 ? Number((quotaDelta / responseTotal).toFixed(4)) : null,
    matches: quotaDelta === responseTotal,
    consistent: dashboardDelta === quotaDelta,
  };
}

async function viaRexu() {
  const email = `upstream-test-${randomUUID()}@rexu.local`;
  const [user] = await getDb()
    .insert(users)
    .values({
      email,
      passwordHash: 'not-used',
      name: 'Upstream Test',
      role: 'customer',
      status: 'active',
    })
    .returning({ id: users.id });
  if (!user) throw new Error('failed to create test user');
  await getDb().insert(wallets).values({ userId: user.id, totalCredits: 0n });

  const rawKey = generateApiKey();
  await getDb()
    .insert(apiKeys)
    .values({
      userId: user.id,
      name: 'upstream-test',
      keyPrefix: apiKeyPrefix(rawKey),
      keyHash: hashApiKey(rawKey),
      lastFour: apiKeyLastFour(rawKey),
      rateLimitPerMin: 60,
    });

  try {
    const before = await quota();
    const response = await fetch(`${rexuBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${rawKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: `Balas satu kata. ${randomUUID()}` }],
        max_tokens: 8,
        temperature: 0,
      }),
    });
    const body = (await response.json()) as {
      usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
    };
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const after = await quota();

    const usageResponse = await fetch(`${rexuBase}/v1/usage`, {
      headers: { authorization: `Bearer ${rawKey}` },
    });
    const usageBody = (await usageResponse.json()) as {
      totals?: { rawTokens?: number; requests?: number };
      by_model?: Array<{ model?: string; raw_tokens?: number; requests?: number }>;
    };

    const quotaDelta = num(before.remainingTokens) - num(after.remainingTokens);
    const responseTotal = num(body.usage?.total_tokens);
    const rexuRaw = num(usageBody.totals?.rawTokens);

    return {
      httpStatus: response.status,
      rexuUsageResponse: body.usage ?? null,
      rexuRecordedRawTokens: rexuRaw,
      rexuUsageEndpoint: usageBody.totals ?? null,
      quotaDelta,
      matchesResponseUsage: quotaDelta === responseTotal,
      matchesRexuUsage: quotaDelta === rexuRaw,
      consistentWithDashboard:
        num(after.usage?.total_tokens) - num(before.usage?.total_tokens) === quotaDelta,
    };
  } finally {
    await getDb().delete(users).where(eq(users.id, user.id));
  }
}

async function main() {
  const direct = [
    await directRequest('small', 'deepseek-v4.1-flash', `Balas satu kata: ok. ${randomUUID()}`),
    await directRequest(
      'medium',
      'deepseek-v4.1-flash',
      `Ringkas dalam satu kata: ${'a'.repeat(10_000)} ${randomUUID()}`,
    ),
  ];

  let rexu: Awaited<ReturnType<typeof viaRexu>> | null = null;
  let rexuError: string | null = null;
  try {
    rexu = await viaRexu();
  } catch (error) {
    rexuError = error instanceof Error ? error.message : String(error);
  }

  const allDirectMatch = direct.every(
    (item) => item.matches && item.consistent && item.httpStatus === 200,
  );
  const rexuMatch = Boolean(
    rexu &&
      rexu.httpStatus === 200 &&
      rexu.consistentWithDashboard &&
      rexu.matchesResponseUsage &&
      rexu.matchesRexuUsage,
  );
  const verdict = allDirectMatch && rexuMatch ? 'matches' : 'pending_verification';

  const report = {
    checkedAt: new Date().toISOString(),
    billingEnabled: process.env.BILLING_ENABLED === 'true',
    direct,
    viaRexu: rexu,
    rexuError,
    verdict,
    note:
      verdict === 'matches'
        ? 'Upstream quota delta equals Rexu usage for the tested requests.'
        : 'Upstream quota delta does not equal response usage. Do not enable BILLING_ENABLED until the upstream billing formula is verified.',
  };

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(
    path.join('tmp', 'upstream-billing-verify.json'),
    JSON.stringify(report, null, 2),
  );

  console.log(JSON.stringify(report, null, 2));
  if (verdict !== 'matches') process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getDb().delete(users).where(like(users.email, 'upstream-test-%@rexu.local'));
    } catch {
      // report the original failure
    }
    await closeDb();
  });
