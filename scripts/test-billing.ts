import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  calculateDeductedCredits,
  createUsageRecord,
  getWalletSnapshot,
  markSkippedUsage,
  reconcileExpiredReservations,
  reconcileUsage,
  releaseUsage,
  reserveUsage,
  settleUsage,
} from '../apps/api/src/modules/billing/service.js';
import type { NormalizedUsage } from '../apps/api/src/providers/bankai.js';
import { closeDb, getDb, loadEnv, schema } from '../packages/db/src/index.js';

loadEnv();

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_BILLING_TESTS !== 'true') {
  console.error('Set ALLOW_BILLING_TESTS=true and do not run this against production');
  process.exit(1);
}

const { users, wallets, usageLogs, auditLogs, models } = schema;
const createdUsers: string[] = [];

function usage(promptTokens: number, completionTokens: number): NormalizedUsage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    reasoningTokens: 0,
    cachedTokens: 0,
    rawTokens: promptTokens + completionTokens,
  };
}

async function modelId(): Promise<string> {
  const rows = await getDb().select({ id: models.id }).from(models).limit(1);
  if (!rows[0]) throw new Error('No model in database. Run model sync first.');
  return rows[0].id;
}

async function adminId(): Promise<string> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .limit(1);
  if (!rows[0]) throw new Error('No admin user. Run seed admin first.');
  return rows[0].id;
}

async function createUser(totalCredits: bigint): Promise<string> {
  const [user] = await getDb()
    .insert(users)
    .values({
      email: `billing-test-${randomUUID()}@rexu.local`,
      passwordHash: 'not-used',
      name: 'Billing Test',
      role: 'customer',
      status: 'active',
    })
    .returning({ id: users.id });
  if (!user) throw new Error('failed to create test user');
  await getDb().insert(wallets).values({ userId: user.id, totalCredits });
  createdUsers.push(user.id);
  return user.id;
}

async function reserve(
  userId: string,
  model: string,
  reserveCredits: number,
  multiplierBp = 10_000,
  bankaiMultiplierBp = 10_000,
  minBlockOverride: number | null = null,
) {
  return reserveUsage({
    userId,
    source: 'api',
    modelId: model,
    idempotencyKey: randomUUID(),
    isStream: false,
    multiplierBp,
    bankaiMultiplierBp,
    minBlockOverride,
    reserveCredits,
  });
}

async function wallet(userId: string) {
  const snapshot = await getWalletSnapshot(userId);
  if (!snapshot) throw new Error('wallet missing');
  return snapshot;
}

async function logStatus(logId: string) {
  const rows = await getDb()
    .select({ status: usageLogs.status, deducted: usageLogs.creditsDeducted })
    .from(usageLogs)
    .where(eq(usageLogs.id, logId))
    .limit(1);
  return rows[0];
}

async function cleanup() {
  if (createdUsers.length === 0) return;
  await getDb().delete(auditLogs).where(inArray(auditLogs.resourceId, createdUsers));
  await getDb().delete(users).where(inArray(users.id, createdUsers));
}

async function main() {
  const model = await modelId();
  const admin = await adminId();

  assert.equal(calculateDeductedCredits(1000, 20_000).toString(), '5');
  assert.equal(calculateDeductedCredits(1001, 15_000).toString(), '4');
  assert.equal(calculateDeductedCredits(1000, 20_000, null, 12_000).toString(), '5');
  assert.equal(calculateDeductedCredits(7000, 10_000).toString(), '7');
  assert.equal(calculateDeductedCredits(1, 10_000, 45_680).toString(), '46');

  {
    const user = await createUser(10n);
    const results = await Promise.allSettled([reserve(user, model, 6), reserve(user, model, 6)]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'only one concurrent reservation may fit');
    assert.equal(rejected.length, 1, 'the second reservation must be rejected');
    assert.equal((await wallet(user)).reserved, '6');
    console.log('PASS concurrent reservation limit');
  }

  {
    const user = await createUser(10n);
    const { logId } = await reserve(user, model, 5);
    const results = await Promise.all([
      settleUsage(logId, usage(600, 400)),
      settleUsage(logId, usage(600, 400)),
    ]);
    assert.equal(results.filter((result) => !result.alreadySettled).length, 1);
    assert.equal((await wallet(user)).used, '3');
    assert.equal((await wallet(user)).reserved, '0');
    assert.equal((await logStatus(logId))?.status, 'finalized');
    console.log('PASS concurrent settlement is idempotent');
  }

  {
    const user = await createUser(10n);
    const a = await reserve(user, model, 3);
    const b = await reserve(user, model, 3);
    await Promise.all([
      settleUsage(a.logId, usage(500, 500)),
      settleUsage(b.logId, usage(500, 500)),
    ]);
    assert.equal((await wallet(user)).used, '6');
    assert.equal((await wallet(user)).reserved, '0');
    console.log('PASS concurrent settlement of different requests');
  }

  {
    const user = await createUser(10n);
    const { logId } = await reserve(user, model, 5);
    assert.equal(await releaseUsage(logId, 'failed', 'upstream_error'), true);
    assert.equal((await wallet(user)).reserved, '0');
    assert.equal((await wallet(user)).used, '0');
    assert.equal((await logStatus(logId))?.status, 'failed');
    console.log('PASS upstream error releases reservation');
  }

  {
    const user = await createUser(10n);
    const timeout = await reserve(user, model, 4);
    await releaseUsage(timeout.logId, 'reconciliation', 'timeout');
    const disconnect = await reserve(user, model, 4);
    await releaseUsage(disconnect.logId, 'reconciliation', 'client_aborted');
    const missing = await reserve(user, model, 4);
    await releaseUsage(missing.logId, 'reconciliation', 'usage_missing');
    assert.equal((await wallet(user)).reserved, '0');
    assert.equal((await logStatus(timeout.logId))?.status, 'reconciliation');
    assert.equal((await logStatus(disconnect.logId))?.status, 'reconciliation');
    assert.equal((await logStatus(missing.logId))?.status, 'reconciliation');
    console.log('PASS timeout, disconnect, and missing usage enter reconciliation');
  }

  {
    const user = await createUser(10n);
    const { logId } = await reserve(user, model, 5, 10_000, 15_000);
    const result = await settleUsage(logId, usage(1200, 800));
    assert.equal(result.tokensBilled.toString(), '3000');
    assert.equal(result.creditsDeducted.toString(), '4');
    assert.equal((await wallet(user)).used, '4');
    console.log('PASS multiplier snapshot is used at settlement');
  }

  {
    const user = await createUser(100n);
    const { logId } = await reserve(user, model, 5, 10_000, 10_000, 45_680);
    const result = await settleUsage(logId, usage(10, 5));
    assert.equal(result.creditsDeducted.toString(), '46');
    assert.equal((await wallet(user)).used, '46');
    const rows = await getDb()
      .select({ effectiveMinBlock: usageLogs.effectiveMinBlock })
      .from(usageLogs)
      .where(eq(usageLogs.id, logId))
      .limit(1);
    assert.equal(rows[0]?.effectiveMinBlock, 45_680);
    console.log('PASS min block override is snapshotted and applied at settlement');
  }

  {
    const user = await createUser(10n);
    const a = await reserve(user, model, 6);
    const b = await reserve(user, model, 3);
    const settledA = await settleUsage(a.logId, usage(4000, 3000));
    assert.equal(settledA.creditsDeducted.toString(), '7');
    assert.equal((await wallet(user)).reserved, '3');

    const settledB = await settleUsage(b.logId, usage(2000, 2000));
    assert.equal(settledB.creditsDeducted.toString(), '3');
    assert.equal(settledB.shortfall.toString(), '1');
    assert.equal(settledB.status, 'insufficient_quota');
    assert.equal((await wallet(user)).used, '10');
    assert.equal((await wallet(user)).reserved, '0');
    assert.equal((await logStatus(b.logId))?.status, 'insufficient_quota');
    console.log('PASS settlement preserves other active reservations');
  }

  {
    const user = await createUser(10n);
    const key = randomUUID();
    const base = {
      userId: user,
      source: 'api' as const,
      modelId: model,
      idempotencyKey: key,
      isStream: false,
      multiplierBp: 10_000,
      bankaiMultiplierBp: 10_000,
      reserveCredits: 1,
    };
    const first = await reserveUsage(base);
    await assert.rejects(() => reserveUsage(base));
    assert.equal((await wallet(user)).reserved, '1');
    assert.ok(first.logId);
    console.log('PASS duplicate reservation key is rejected');
  }

  {
    const user = await createUser(10n);
    const { logId } = await reserve(user, model, 5);
    await getDb()
      .update(usageLogs)
      .set({ reservationExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(usageLogs.id, logId));
    const released = await reconcileExpiredReservations(100);
    assert.ok(released >= 1);
    assert.equal((await wallet(user)).reserved, '0');
    assert.equal((await logStatus(logId))?.status, 'reconciliation');
    console.log('PASS expired reservations are released for reconciliation');
  }

  {
    const user = await createUser(10n);
    const { logId } = await reserve(user, model, 5);
    await releaseUsage(logId, 'reconciliation', 'usage_missing');
    const result = await reconcileUsage(
      logId,
      { promptTokens: 600, completionTokens: 400 },
      admin,
      'manual test reconcile',
    );
    assert.equal(result.creditsDeducted.toString(), '3');
    assert.equal((await wallet(user)).used, '3');
    assert.equal((await logStatus(logId))?.status, 'finalized');
    const audits = await getDb()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, user));
    assert.ok(audits.some((row) => row.action === 'wallet.reconcile'));
    console.log('PASS manual reconciliation and audit log');
  }

  {
    const user = await createUser(0n);
    const logId = await createUsageRecord({
      userId: user,
      source: 'api',
      modelId: model,
      idempotencyKey: randomUUID(),
      isStream: false,
      multiplierBp: 10_000,
      bankaiMultiplierBp: 20_000,
    });
    await markSkippedUsage(logId, usage(600, 400), { httpStatus: 200 });

    const rows = await getDb()
      .select({
        status: usageLogs.status,
        creditsDeducted: usageLogs.creditsDeducted,
        tokensBilled: usageLogs.tokensBilled,
      })
      .from(usageLogs)
      .where(eq(usageLogs.id, logId))
      .limit(1);
    assert.equal(rows[0]?.status, 'skipped');
    assert.equal(rows[0]?.creditsDeducted.toString(), '5');
    assert.equal(rows[0]?.tokensBilled.toString(), '0');
    assert.equal((await wallet(user)).used, '0');
    assert.equal((await wallet(user)).reserved, '0');
    console.log('PASS skipped usage records shadow credits without touching wallet');
  }

  {
    const rows = await getDb().execute(sql`SELECT count(*)::int AS count FROM audit_logs`);
    assert.ok(Number((rows.rows[0] as { count: number }).count) > 0);
    console.log('PASS audit log has balance entries');
  }
}

try {
  await main();
  console.log('all billing tests passed');
} finally {
  await cleanup();
  await closeDb();
}
