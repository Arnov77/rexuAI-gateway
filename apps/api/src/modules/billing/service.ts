import { type Database, getDb, schema } from '@rexu/db';
import { type ChatCompletionRequest, SETTINGS_KEYS } from '@rexu/shared';
import { and, eq, lte, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { AppError, conflict } from '../../lib/errors.js';
import { getSetting } from '../../lib/settings.js';
import type { NormalizedUsage } from '../../providers/bankai.js';

const { usageLogs, wallets, auditLogs, models } = schema;

/** 1 credit (RC) = 1.000 token BankAI. */
export const CREDIT_RATE = 1_000n;

const BP = 10_000n;

/** Minimum block dasar sebelum dikali multiplier BankAI. */
const MIN_BLOCK_BASE = 2_048n;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

type SqlRow = Record<string, unknown>;

type WalletSnapshot = {
  total: bigint;
  used: bigint;
  reserved: bigint;
};

type UsageRecordInput = {
  userId: string;
  apiKeyId?: string | null;
  conversationId?: string | null;
  source: 'api' | 'playground';
  modelId: string;
  idempotencyKey: string;
  isStream: boolean;
  multiplierBp: number;
  bankaiMultiplierBp: number;
  minBlockOverride?: number | null;
};

type UsageTerminalMeta = {
  httpStatus?: number | null;
  upstreamRequestId?: string | null;
  latencyMs?: number | null;
  errorCode?: string | null;
};

export type SettlementResult = {
  status: string;
  creditsDeducted: bigint;
  tokensBilled: bigint;
  shortfall: bigint;
  alreadySettled: boolean;
};

function toBigInt(value: unknown): bigint {
  return BigInt(String(value));
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

function walletFromRow(row: SqlRow | undefined): WalletSnapshot | null {
  if (!row) return null;
  return {
    total: toBigInt(row.total_credits),
    used: toBigInt(row.used_credits),
    reserved: toBigInt(row.reserved_credits),
  };
}

async function lockWallet(tx: Tx, userId: string): Promise<WalletSnapshot | null> {
  const result = await tx.execute(sql`
    SELECT total_credits, used_credits, reserved_credits
    FROM wallets
    WHERE user_id = ${userId}::uuid
    FOR UPDATE
  `);
  return walletFromRow(result.rows[0] as SqlRow | undefined);
}

async function audit(
  tx: Tx,
  params: {
    actorUserId: string | null;
    action: string;
    userId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: params.actorUserId,
    action: params.action,
    resourceType: 'wallet',
    resourceId: params.userId,
    metadata: params.metadata,
  });
}

function contentStats(content: unknown): { chars: number; images: number } {
  if (typeof content === 'string') return { chars: content.length, images: 0 };
  if (Array.isArray(content)) {
    let chars = 0;
    let images = 0;
    for (const part of content) {
      const record = part as Record<string, unknown>;
      const type = String(record.type ?? '');
      if (type.includes('image') || 'image_url' in record || 'image' in record) {
        images += 1;
      }
      chars += JSON.stringify(part).length;
    }
    return { chars, images };
  }
  return { chars: JSON.stringify(content ?? '').length, images: 0 };
}

export function calculateBilledTokens(
  rawTokens: number,
  bankaiMultiplierBp: number,
  rexuMarkupBp: number = 10_000,
): bigint {
  if (!Number.isSafeInteger(rawTokens) || rawTokens < 0) {
    throw new RangeError('rawTokens must be a safe non-negative integer');
  }
  if (!Number.isSafeInteger(bankaiMultiplierBp) || bankaiMultiplierBp < 0) {
    throw new RangeError('bankaiMultiplierBp must be a safe non-negative integer');
  }
  if (!Number.isSafeInteger(rexuMarkupBp) || rexuMarkupBp <= 0) {
    throw new RangeError('rexuMarkupBp must be a safe positive integer');
  }
  return (
    (BigInt(rawTokens) * BigInt(bankaiMultiplierBp) * BigInt(rexuMarkupBp) + (BP * BP - 1n)) /
    (BP * BP)
  );
}

export function getEffectiveMinBlock(
  bankaiMultiplierBp: number,
  minBlockOverride: number | null = null,
): bigint {
  if (!Number.isSafeInteger(bankaiMultiplierBp) || bankaiMultiplierBp < 0) {
    throw new RangeError('bankaiMultiplierBp must be a safe non-negative integer');
  }
  if (minBlockOverride != null && Number.isSafeInteger(minBlockOverride) && minBlockOverride > 0) {
    return BigInt(minBlockOverride);
  }
  return (MIN_BLOCK_BASE * BigInt(bankaiMultiplierBp)) / BP;
}

export function calculateDeductedCredits(
  rawTokens: number,
  bankaiMultiplierBp: number,
  minBlockOverride: number | null = null,
  rexuMarkupBp: number = 10_000,
): bigint {
  const tokensByFormula = calculateBilledTokens(rawTokens, bankaiMultiplierBp, rexuMarkupBp);
  const minBlock = getEffectiveMinBlock(bankaiMultiplierBp, minBlockOverride);
  let effectiveTokens = tokensByFormula;
  if (minBlock > effectiveTokens) effectiveTokens = minBlock;
  return (effectiveTokens + CREDIT_RATE - 1n) / CREDIT_RATE;
}

async function lookupModelMinBlockOverride(tx: Tx, modelId: string | null): Promise<number | null> {
  if (!modelId) return null;
  const rows = await tx
    .select({ minBlockOverride: models.minBlockOverride })
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);
  return rows[0]?.minBlockOverride ?? null;
}

function resolveMinBlock(
  bankaiMultiplierBp: number,
  storedEffective: number | null,
  modelOverride: number | null,
): { override: number | null; effective: bigint } {
  // Snapshot di usage_logs sudah merupakan nilai final saat request dibuat.
  if (storedEffective != null && storedEffective > 0) {
    return { override: storedEffective, effective: BigInt(storedEffective) };
  }
  return {
    override: modelOverride,
    effective: getEffectiveMinBlock(bankaiMultiplierBp, modelOverride),
  };
}

async function resolveUsageMinBlock(
  tx: Tx,
  log: { effectiveMinBlock: number | null; modelId: string | null },
  bankaiMultiplierBp: number,
): Promise<{ override: number | null; effective: bigint }> {
  const modelOverride =
    log.effectiveMinBlock == null ? await lookupModelMinBlockOverride(tx, log.modelId) : null;
  return resolveMinBlock(bankaiMultiplierBp, log.effectiveMinBlock, modelOverride);
}

export async function estimateReservationCredits(
  body: ChatCompletionRequest,
  bankaiMultiplierBp: number = 10_000,
  minBlockOverride: number | null = null,
): Promise<number> {
  const defaultCompletion = await getSetting<number>(SETTINGS_KEYS.billingDefaultReserve, 8192);
  const requestedCompletion = Math.max(
    Number(body.max_tokens ?? 0),
    Number(body.max_completion_tokens ?? 0),
  );
  const completionReserve =
    requestedCompletion > 0 ? requestedCompletion : Math.max(1, defaultCompletion);

  let chars = 0;
  let images = 0;
  for (const message of body.messages) {
    const stats = contentStats(message.content);
    chars += stats.chars;
    images += stats.images;
  }

  const estimatedRaw = Math.ceil(chars * 0.6 + 512) + completionReserve + images * 4096;
  const total = calculateDeductedCredits(estimatedRaw, bankaiMultiplierBp, minBlockOverride) + 1n;

  if (total > BigInt(env.BILLING_MAX_RESERVE)) {
    throw new AppError(
      400,
      'request_too_large',
      `Reservation melebihi batas ${env.BILLING_MAX_RESERVE} RC`,
      { type: 'invalid_request_error' },
    );
  }

  return Number(total);
}

export async function createUsageRecord(input: UsageRecordInput): Promise<string> {
  try {
    const [row] = await getDb()
      .insert(usageLogs)
      .values({
        userId: input.userId,
        apiKeyId: input.apiKeyId ?? null,
        conversationId: input.conversationId ?? null,
        source: input.source,
        modelId: input.modelId,
        idempotencyKey: input.idempotencyKey,
        isStream: input.isStream,
        multiplierBp: input.multiplierBp,
        bankaiMultiplierBp: input.bankaiMultiplierBp,
        effectiveMinBlock: Number(
          getEffectiveMinBlock(input.bankaiMultiplierBp, input.minBlockOverride ?? null),
        ),
        status: 'pending',
      })
      .returning({ id: usageLogs.id });
    if (!row) throw new Error('failed to create usage log');
    return row.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('Request dengan idempotency key yang sama sudah diproses');
    }
    throw error;
  }
}

export async function reserveUsage(
  input: UsageRecordInput & { reserveCredits: number },
): Promise<{ logId: string; reservedCredits: bigint }> {
  if (input.reserveCredits <= 0 || input.reserveCredits > env.BILLING_MAX_RESERVE) {
    throw new AppError(400, 'invalid_reservation', 'Jumlah reservation tidak valid', {
      type: 'invalid_request_error',
    });
  }

  const reserve = BigInt(input.reserveCredits);
  const reservedTokens = reserve * CREDIT_RATE;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.BILLING_RESERVATION_TTL_MS);

  try {
    return await getDb().transaction(async (tx) => {
      const [row] = await tx
        .insert(usageLogs)
        .values({
          userId: input.userId,
          apiKeyId: input.apiKeyId ?? null,
          conversationId: input.conversationId ?? null,
          source: input.source,
          modelId: input.modelId,
          idempotencyKey: input.idempotencyKey,
          isStream: input.isStream,
          multiplierBp: input.multiplierBp,
          bankaiMultiplierBp: input.bankaiMultiplierBp,
          effectiveMinBlock: Number(
            getEffectiveMinBlock(input.bankaiMultiplierBp, input.minBlockOverride ?? null),
          ),
          status: 'reserved',
          creditsReserved: reserve,
          tokensReserved: reservedTokens,
          reservedAt: now,
          reservationExpiresAt: expiresAt,
        })
        .returning({ id: usageLogs.id });
      if (!row) throw new Error('failed to create usage log');

      const updated = await tx.execute(sql`
        UPDATE wallets
        SET reserved_credits = reserved_credits + ${reserve.toString()}::bigint,
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND (expires_at IS NULL OR expires_at > now())
          AND total_credits - used_credits - reserved_credits >= ${reserve.toString()}::bigint
        RETURNING total_credits, used_credits, reserved_credits
      `);

      const walletRow = updated.rows[0] as SqlRow | undefined;
      const wallet = walletFromRow(walletRow);
      if (!wallet) {
        throw new AppError(429, 'insufficient_quota', 'Kuota tidak cukup untuk request ini', {
          type: 'insufficient_quota',
        });
      }

      await audit(tx, {
        actorUserId: input.userId,
        action: 'wallet.reserve',
        userId: input.userId,
        metadata: {
          usageLogId: row.id,
          reservedCredits: reserve.toString(),
          reservedTokens: reservedTokens.toString(),
          reservedAfter: wallet.reserved.toString(),
          availableAfter: (wallet.total - wallet.used - wallet.reserved).toString(),
        },
      });

      return { logId: row.id, reservedCredits: reserve };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('Request dengan idempotency key yang sama sudah diproses');
    }
    throw error;
  }
}

export async function settleUsage(
  logId: string,
  usage: NormalizedUsage,
  meta: UsageTerminalMeta = {},
): Promise<SettlementResult> {
  const rawTokens = usage.rawTokens;
  if (rawTokens == null) {
    throw new AppError(409, 'usage_missing', 'Usage aktual tidak tersedia untuk settlement');
  }

  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(usageLogs).where(eq(usageLogs.id, logId)).for('update');
    const log = rows[0];
    if (!log) throw new AppError(404, 'usage_not_found', 'Usage log tidak ditemukan');

    const rexuMarkupBp = log.multiplierBp ?? 10_000;

    if (['finalized', 'skipped', 'insufficient_quota'].includes(log.status)) {
      return {
        status: log.status,
        creditsDeducted: log.creditsDeducted,
        tokensBilled: log.tokensBilled,
        shortfall: 0n,
        alreadySettled: true,
      };
    }
    if (log.status !== 'reserved') {
      throw new AppError(
        409,
        'invalid_billing_state',
        `Usage log berstatus ${log.status}, bukan reserved`,
      );
    }
    if (log.bankaiMultiplierBp == null) {
      throw new AppError(409, 'invalid_billing_state', 'BankAI multiplier snapshot tidak tersedia');
    }

    const minBlock = await resolveUsageMinBlock(tx, log, log.bankaiMultiplierBp);

    const wallet = await lockWallet(tx, log.userId);
    if (!wallet) throw new AppError(409, 'wallet_missing', 'Wallet tidak ditemukan');

    const thisReserve = log.creditsReserved;
    const otherReserved = wallet.reserved - thisReserve;
    if (otherReserved < 0n) {
      throw new AppError(409, 'billing_state_mismatch', 'Reservation wallet tidak konsisten');
    }

    const calculated = calculateDeductedCredits(
      rawTokens,
      log.bankaiMultiplierBp,
      minBlock.override,
      rexuMarkupBp,
    );
    const tokensBilled = calculateBilledTokens(rawTokens, log.bankaiMultiplierBp, rexuMarkupBp);
    const maxDeductible = wallet.total - wallet.used - otherReserved;
    const applied =
      calculated < maxDeductible ? calculated : maxDeductible > 0n ? maxDeductible : 0n;
    const shortfall = calculated - applied;
    const status = shortfall > 0n ? 'insufficient_quota' : 'finalized';

    const updated = await tx.execute(sql`
      UPDATE wallets
      SET used_credits = used_credits + ${applied.toString()}::bigint,
          reserved_credits = reserved_credits - ${thisReserve.toString()}::bigint,
          updated_at = now()
      WHERE user_id = ${log.userId}::uuid
        AND reserved_credits >= ${thisReserve.toString()}::bigint
        AND used_credits + ${applied.toString()}::bigint
            + (reserved_credits - ${thisReserve.toString()}::bigint) <= total_credits
      RETURNING total_credits, used_credits, reserved_credits
    `);

    const after = walletFromRow(updated.rows[0] as SqlRow | undefined);
    if (!after) {
      throw new AppError(409, 'billing_state_mismatch', 'Settlement wallet gagal');
    }

    await tx
      .update(usageLogs)
      .set({
        status,
        httpStatus: meta.httpStatus ?? null,
        upstreamRequestId: meta.upstreamRequestId ?? null,
        rawTokens,
        cachedTokens: usage.cachedTokens,
        contextTokens: usage.promptTokens ?? 0,
        generationTokens: usage.completionTokens ?? 0,
        bankaiMultiplierBp: log.bankaiMultiplierBp,
        effectiveMinBlock: Number(minBlock.effective),
        tokensBilled,
        creditsDeducted: applied,
        tokensReserved: 0n,
        creditsReserved: 0n,
        latencyMs: meta.latencyMs ?? null,
        errorCode: shortfall > 0n ? 'insufficient_quota' : (meta.errorCode ?? null),
        finalizedAt: new Date(),
      })
      .where(eq(usageLogs.id, logId));

    await audit(tx, {
      actorUserId: log.userId,
      action: 'wallet.settle',
      userId: log.userId,
      metadata: {
        usageLogId: logId,
        rawTokens,
        multiplierBp: log.multiplierBp,
        bankaiMultiplierBp: log.bankaiMultiplierBp,
        minBlockOverride: minBlock.override,
        effectiveMinBlock: minBlock.effective.toString(),
        tokensBilled: tokensBilled.toString(),
        calculatedCredits: calculated.toString(),
        appliedCredits: applied.toString(),
        shortfall: shortfall.toString(),
        reservedReleased: thisReserve.toString(),
        reservedAfter: after.reserved.toString(),
        usedAfter: after.used.toString(),
        availableAfter: (after.total - after.used - after.reserved).toString(),
      },
    });

    return {
      status,
      creditsDeducted: applied,
      tokensBilled,
      shortfall,
      alreadySettled: false,
    };
  });
}

export async function releaseUsage(
  logId: string,
  status: 'failed' | 'reconciliation',
  errorCode: string,
  meta: UsageTerminalMeta = {},
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(usageLogs).where(eq(usageLogs.id, logId)).for('update');
    const log = rows[0];
    if (!log) return false;
    if (log.status !== 'reserved') return false;

    const thisReserve = log.creditsReserved;
    const wallet = await lockWallet(tx, log.userId);
    if (!wallet) throw new AppError(409, 'wallet_missing', 'Wallet tidak ditemukan');
    if (wallet.reserved < thisReserve) {
      throw new AppError(409, 'billing_state_mismatch', 'Reservation wallet tidak konsisten');
    }

    const updated = await tx.execute(sql`
      UPDATE wallets
      SET reserved_credits = reserved_credits - ${thisReserve.toString()}::bigint,
          updated_at = now()
      WHERE user_id = ${log.userId}::uuid
        AND reserved_credits >= ${thisReserve.toString()}::bigint
      RETURNING total_credits, used_credits, reserved_credits
    `);
    const after = walletFromRow(updated.rows[0] as SqlRow | undefined);
    if (!after) {
      throw new AppError(409, 'billing_state_mismatch', 'Release reservation gagal');
    }

    await tx
      .update(usageLogs)
      .set({
        status,
        httpStatus: meta.httpStatus ?? null,
        upstreamRequestId: meta.upstreamRequestId ?? null,
        latencyMs: meta.latencyMs ?? null,
        errorCode,
        tokensReserved: 0n,
        creditsReserved: 0n,
        finalizedAt: new Date(),
      })
      .where(eq(usageLogs.id, logId));

    await audit(tx, {
      actorUserId: null,
      action: 'wallet.release',
      userId: log.userId,
      metadata: {
        usageLogId: logId,
        status,
        errorCode,
        reservedReleased: thisReserve.toString(),
        reservedAfter: after.reserved.toString(),
        availableAfter: (after.total - after.used - after.reserved).toString(),
      },
    });

    return true;
  });
}

export async function markSkippedUsage(
  logId: string,
  usage: NormalizedUsage,
  meta: UsageTerminalMeta = {},
): Promise<void> {
  const rawTokens = usage.rawTokens;
  const rows = await getDb()
    .select({
      bankaiMultiplierBp: usageLogs.bankaiMultiplierBp,
      multiplierBp: usageLogs.multiplierBp,
      effectiveMinBlock: usageLogs.effectiveMinBlock,
      modelId: usageLogs.modelId,
    })
    .from(usageLogs)
    .where(eq(usageLogs.id, logId))
    .limit(1);
  const snapshot = rows[0];

  let modelOverride: number | null = null;
  if (snapshot?.effectiveMinBlock == null && snapshot?.modelId) {
    const modelRows = await getDb()
      .select({ minBlockOverride: models.minBlockOverride })
      .from(models)
      .where(eq(models.id, snapshot.modelId))
      .limit(1);
    modelOverride = modelRows[0]?.minBlockOverride ?? null;
  }
  const minBlock =
    snapshot?.bankaiMultiplierBp != null
      ? resolveMinBlock(snapshot.bankaiMultiplierBp, snapshot.effectiveMinBlock, modelOverride)
      : null;

  // Shadow billing: billing is disabled, so the wallet is untouched. The
  // counterfactual charge is recorded so it can be compared with BankAI quota.
  const creditsDeducted =
    rawTokens != null &&
    Number.isSafeInteger(rawTokens) &&
    rawTokens >= 0 &&
    snapshot?.bankaiMultiplierBp != null &&
    minBlock != null
      ? calculateDeductedCredits(rawTokens, snapshot.bankaiMultiplierBp, minBlock.override)
      : 0n;

  await getDb()
    .update(usageLogs)
    .set({
      status: 'skipped',
      httpStatus: meta.httpStatus ?? null,
      upstreamRequestId: meta.upstreamRequestId ?? null,
      rawTokens: rawTokens ?? 0,
      cachedTokens: usage.cachedTokens,
      contextTokens: usage.promptTokens ?? 0,
      generationTokens: usage.completionTokens ?? 0,
      effectiveMinBlock: minBlock == null ? null : Number(minBlock.effective),
      tokensBilled: 0n,
      creditsDeducted,
      tokensReserved: 0n,
      creditsReserved: 0n,
      latencyMs: meta.latencyMs ?? null,
      errorCode: null,
      finalizedAt: new Date(),
    })
    .where(eq(usageLogs.id, logId));
}

export async function markTerminalUsage(
  logId: string,
  status: 'failed' | 'reconciliation',
  errorCode: string,
  meta: UsageTerminalMeta = {},
): Promise<void> {
  await getDb()
    .update(usageLogs)
    .set({
      status,
      httpStatus: meta.httpStatus ?? null,
      upstreamRequestId: meta.upstreamRequestId ?? null,
      latencyMs: meta.latencyMs ?? null,
      errorCode,
      tokensReserved: 0n,
      creditsReserved: 0n,
      finalizedAt: new Date(),
    })
    .where(eq(usageLogs.id, logId));
}

export async function reconcileUsage(
  logId: string,
  input: { promptTokens: number; completionTokens: number; cachedTokens?: number },
  adminId: string,
  note: string,
): Promise<SettlementResult> {
  const rawTokens = input.promptTokens + input.completionTokens;

  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(usageLogs).where(eq(usageLogs.id, logId)).for('update');
    const log = rows[0];
    if (!log) throw new AppError(404, 'usage_not_found', 'Usage log tidak ditemukan');
    const rexuMarkupBp = log.multiplierBp ?? 10_000;
    if (['finalized', 'skipped', 'insufficient_quota'].includes(log.status)) {
      return {
        status: log.status,
        creditsDeducted: log.creditsDeducted,
        tokensBilled: log.tokensBilled,
        shortfall: 0n,
        alreadySettled: true,
      };
    }
    if (!['reconciliation', 'reserved', 'failed'].includes(log.status)) {
      throw new AppError(409, 'invalid_billing_state', 'Usage tidak bisa direkonsiliasi');
    }
    if (log.bankaiMultiplierBp == null) {
      throw new AppError(409, 'invalid_billing_state', 'BankAI multiplier snapshot tidak tersedia');
    }

    const minBlock = await resolveUsageMinBlock(tx, log, log.bankaiMultiplierBp);

    const wallet = await lockWallet(tx, log.userId);
    if (!wallet) throw new AppError(409, 'wallet_missing', 'Wallet tidak ditemukan');

    const thisReserve = log.status === 'reserved' ? log.creditsReserved : 0n;
    const otherReserved = wallet.reserved - thisReserve;
    if (otherReserved < 0n) {
      throw new AppError(409, 'billing_state_mismatch', 'Reservation wallet tidak konsisten');
    }

    const calculated = calculateDeductedCredits(
      rawTokens,
      log.bankaiMultiplierBp,
      minBlock.override,
      rexuMarkupBp,
    );
    const tokensBilled = calculateBilledTokens(rawTokens, log.bankaiMultiplierBp, rexuMarkupBp);
    const maxDeductible = wallet.total - wallet.used - otherReserved;
    const applied =
      calculated < maxDeductible ? calculated : maxDeductible > 0n ? maxDeductible : 0n;
    const shortfall = calculated - applied;
    const status = shortfall > 0n ? 'insufficient_quota' : 'finalized';

    const updated = await tx.execute(sql`
      UPDATE wallets
      SET used_credits = used_credits + ${applied.toString()}::bigint,
          reserved_credits = reserved_credits - ${thisReserve.toString()}::bigint,
          updated_at = now()
      WHERE user_id = ${log.userId}::uuid
        AND reserved_credits >= ${thisReserve.toString()}::bigint
        AND used_credits + ${applied.toString()}::bigint
            + (reserved_credits - ${thisReserve.toString()}::bigint) <= total_credits
      RETURNING total_credits, used_credits, reserved_credits
    `);
    const after = walletFromRow(updated.rows[0] as SqlRow | undefined);
    if (!after) {
      throw new AppError(409, 'billing_state_mismatch', 'Rekonsiliasi wallet gagal');
    }

    await tx
      .update(usageLogs)
      .set({
        status,
        rawTokens,
        cachedTokens: input.cachedTokens ?? 0,
        contextTokens: input.promptTokens,
        generationTokens: input.completionTokens,
        bankaiMultiplierBp: log.bankaiMultiplierBp,
        effectiveMinBlock: Number(minBlock.effective),
        tokensBilled,
        creditsDeducted: applied,
        tokensReserved: 0n,
        creditsReserved: 0n,
        errorCode: 'manual_reconcile',
        finalizedAt: new Date(),
      })
      .where(eq(usageLogs.id, logId));

    await audit(tx, {
      actorUserId: adminId,
      action: 'wallet.reconcile',
      userId: log.userId,
      metadata: {
        usageLogId: logId,
        note,
        rawTokens,
        multiplierBp: log.multiplierBp,
        bankaiMultiplierBp: log.bankaiMultiplierBp,
        minBlockOverride: minBlock.override,
        effectiveMinBlock: minBlock.effective.toString(),
        tokensBilled: tokensBilled.toString(),
        calculatedCredits: calculated.toString(),
        appliedCredits: applied.toString(),
        shortfall: shortfall.toString(),
        reservedReleased: thisReserve.toString(),
        reservedAfter: after.reserved.toString(),
        usedAfter: after.used.toString(),
        availableAfter: (after.total - after.used - after.reserved).toString(),
      },
    });

    return {
      status,
      creditsDeducted: applied,
      tokensBilled,
      shortfall,
      alreadySettled: false,
    };
  });
}

export async function reconcileExpiredReservations(limit = 50): Promise<number> {
  const rows = await getDb()
    .select({ id: usageLogs.id })
    .from(usageLogs)
    .where(and(eq(usageLogs.status, 'reserved'), lte(usageLogs.reservationExpiresAt, new Date())))
    .limit(limit);

  let released = 0;
  for (const row of rows) {
    const changed = await releaseUsage(row.id, 'reconciliation', 'reservation_expired');
    if (changed) released += 1;
  }
  return released;
}

export async function getWalletSnapshot(userId: string): Promise<{
  total: string;
  used: string;
  reserved: string;
  available: string;
} | null> {
  const rows = await getDb().select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  const wallet = rows[0];
  if (!wallet) return null;
  return {
    total: wallet.totalCredits.toString(),
    used: wallet.usedCredits.toString(),
    reserved: wallet.reservedCredits.toString(),
    available: (wallet.totalCredits - wallet.usedCredits - wallet.reservedCredits).toString(),
  };
}
