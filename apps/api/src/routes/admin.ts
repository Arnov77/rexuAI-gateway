import { hash } from '@node-rs/argon2';
import { getDb, schema } from '@rexu/db';
import { emailSchema, passwordSchema, SETTINGS_KEYS } from '@rexu/shared';
import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../lib/auth.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { serializeModel, serializeWallet } from '../lib/serialize.js';
import { getSetting } from '../lib/settings.js';
import { sendTelegram } from '../lib/telegram.js';
import { parseWith } from '../lib/validate.js';
import { reconcileExpiredReservations, reconcileUsage } from '../modules/billing/service.js';
import { listModelsForAdmin, syncModels, updateModel } from '../modules/models/service.js';
import { checkQuota, checkReconciliation, checkUpstream } from '../modules/monitor/service.js';
import {
  checkUpstreamHealth,
  type UpstreamHealthResult,
} from '../modules/monitor/upstream-health.js';
import {
  createPackage,
  deactivatePackage,
  listAllPackages,
  updatePackage,
} from '../modules/packages/service.js';
import { bankai } from '../providers/bankai.js';

const { users, wallets, auditLogs, usageLogs, quotaAdjustments, orders } = schema;

const UPSTREAM_HEALTH_CACHE_MS = 60_000;

let upstreamHealthCache: { result: UpstreamHealthResult; expiresAt: number } | null = null;

async function writeAudit(params: {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getDb()
    .insert(auditLogs)
    .values({
      actorUserId: params.actorUserId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      metadata: params.metadata ?? null,
    });
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/models', async () => {
    const rows = await listModelsForAdmin();
    return { data: rows.map((row) => serializeModel(row, true, true)) };
  });

  app.post('/models/sync', async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();
    const result = await syncModels();
    await writeAudit({
      actorUserId: actor.id,
      action: 'model.sync',
      resourceType: 'model',
      metadata: result,
    });
    return { data: result };
  });

  app.patch('/models/:id', async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();
    const { id } = parseWith(z.object({ id: z.string().min(1).max(128) }), request.params);
    const input = parseWith(
      z.object({
        displayName: z.string().trim().min(1).max(120).optional(),
        description: z.string().max(1000).nullable().optional(),
        multiplier: z.number().positive().max(214_748).optional(),
        multiplierBp: z.number().int().positive().max(2_147_483_647).optional(),
        bankaiMultiplier: z.number().min(0).max(214_748).optional(),
        bankaiMultiplierBp: z.number().int().min(0).max(2_147_483_647).optional(),
        minBlockOverride: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
        isEnabled: z.boolean().optional(),
        streaming: z.boolean().optional(),
        category: z.string().max(80).nullable().optional(),
        contextWindow: z.number().int().positive().nullable().optional(),
      }),
      request.body,
    );

    const multiplierBp =
      input.multiplierBp ??
      (input.multiplier != null ? Math.round(input.multiplier * 10_000) : undefined);
    const bankaiMultiplierBp =
      input.bankaiMultiplierBp ??
      (input.bankaiMultiplier != null ? Math.round(input.bankaiMultiplier * 10_000) : undefined);

    const updated = await updateModel(id, {
      displayName: input.displayName,
      description: input.description,
      multiplierBp,
      bankaiMultiplierBp,
      minBlockOverride: input.minBlockOverride,
      isEnabled: input.isEnabled,
      streaming: input.streaming,
      category: input.category,
      contextWindow: input.contextWindow,
    });

    const metadata: Record<string, unknown> = {};
    if (multiplierBp !== undefined) metadata.multiplierBp = multiplierBp;
    if (bankaiMultiplierBp !== undefined) metadata.bankaiMultiplierBp = bankaiMultiplierBp;
    if (input.minBlockOverride !== undefined) metadata.minBlockOverride = input.minBlockOverride;
    if (input.isEnabled !== undefined) metadata.isEnabled = input.isEnabled;
    if (input.streaming !== undefined) metadata.streaming = input.streaming;
    await writeAudit({
      actorUserId: actor.id,
      action: 'model.update',
      resourceType: 'model',
      resourceId: id,
      metadata,
    });

    return { data: serializeModel(updated, true, true) };
  });

  app.get('/packages', async () => {
    return { data: await listAllPackages() };
  });

  app.post('/packages', async (request, reply) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();
    const input = parseWith(
      z.object({
        name: z.string().trim().min(1).max(80),
        priceIdr: z.number().int().min(1).max(2_147_483_647),
        rcAmount: z.number().int().min(1).max(2_147_483_647),
        sortOrder: z.number().int().min(0).max(1_000_000).optional(),
        isActive: z.boolean().optional(),
      }),
      request.body,
    );

    const created = await createPackage(input);
    await writeAudit({
      actorUserId: actor.id,
      action: 'package.create',
      resourceType: 'package',
      resourceId: created.id,
      metadata: {
        name: created.name,
        priceIdr: created.priceIdr,
        rcAmount: created.rcAmount,
        sortOrder: created.sortOrder,
        isActive: created.isActive,
      },
    });

    reply.code(201);
    return { data: created };
  });

  app.patch('/packages/:id', async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();
    const { id } = parseWith(z.object({ id: z.string().uuid() }), request.params);
    const input = parseWith(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        priceIdr: z.number().int().min(1).max(2_147_483_647).optional(),
        rcAmount: z.number().int().min(1).max(2_147_483_647).optional(),
        sortOrder: z.number().int().min(0).max(1_000_000).optional(),
        isActive: z.boolean().optional(),
      }),
      request.body,
    );

    const updated = await updatePackage(id, input);
    await writeAudit({
      actorUserId: actor.id,
      action: 'package.update',
      resourceType: 'package',
      resourceId: id,
      metadata: { ...input },
    });

    return { data: updated };
  });

  app.delete('/packages/:id', async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();
    const { id } = parseWith(z.object({ id: z.string().uuid() }), request.params);

    const updated = await deactivatePackage(id);
    await writeAudit({
      actorUserId: actor.id,
      action: 'package.delete',
      resourceType: 'package',
      resourceId: id,
      metadata: { name: updated.name },
    });

    return { data: updated };
  });

  app.get('/orders', async (request) => {
    const query = parseWith(
      z.object({
        status: z.enum(['pending', 'paid', 'failed', 'expired', 'cancelled']).optional(),
        userId: z.string().uuid().optional(),
        search: z.string().trim().max(120).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      request.query,
    );

    const conditions = [];
    if (query.status) conditions.push(eq(orders.status, query.status));
    if (query.userId) conditions.push(eq(orders.userId, query.userId));
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(or(ilike(users.email, pattern), ilike(users.name, pattern)));
    }
    if (query.from) conditions.push(gte(orders.createdAt, query.from));
    if (query.to) conditions.push(lte(orders.createdAt, query.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const pageSize = 20;

    const [rows, totalRows] = await Promise.all([
      getDb()
        .select({
          id: orders.id,
          userId: orders.userId,
          userEmail: users.email,
          userName: users.name,
          packageId: orders.packageId,
          packageName: orders.packageName,
          amountIdr: orders.priceIdr,
          rcAmount: orders.tokenAmount,
          status: orders.status,
          provider: orders.provider,
          midtransOrderId: orders.providerRef,
          midtransTransactionId: orders.midtransTransactionId,
          expiresAt: orders.expiresAt,
          paidAt: orders.paidAt,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .innerJoin(users, eq(orders.userId, users.id))
        .where(where)
        .orderBy(desc(orders.createdAt))
        .limit(pageSize)
        .offset((query.page - 1) * pageSize),
      getDb()
        .select({ total: count() })
        .from(orders)
        .innerJoin(users, eq(orders.userId, users.id))
        .where(where),
    ]);

    return {
      data: rows.map((row) => ({
        ...row,
        amountIdr: row.amountIdr.toString(),
        rcAmount: row.rcAmount.toString(),
      })),
      total: totalRows[0]?.total ?? 0,
      page: query.page,
      pageSize,
    };
  });

  app.get('/orders/:id', async (request) => {
    const { id } = parseWith(z.object({ id: z.string().uuid() }), request.params);

    const [row] = await getDb()
      .select({
        id: orders.id,
        userId: orders.userId,
        userEmail: users.email,
        userName: users.name,
        packageId: orders.packageId,
        packageName: orders.packageName,
        amountIdr: orders.priceIdr,
        rcAmount: orders.tokenAmount,
        status: orders.status,
        provider: orders.provider,
        midtransOrderId: orders.providerRef,
        midtransTransactionId: orders.midtransTransactionId,
        qrString: orders.qrString,
        qrImageUrl: orders.qrImageUrl,
        paymentType: orders.paymentType,
        webhookPayload: orders.webhookPayload,
        expiresAt: orders.expiresAt,
        paidAt: orders.paidAt,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(users, eq(orders.userId, users.id))
      .where(eq(orders.id, id))
      .limit(1);

    if (!row) throw notFound('Order tidak ditemukan');

    return {
      data: {
        ...row,
        amountIdr: row.amountIdr.toString(),
        rcAmount: row.rcAmount.toString(),
      },
    };
  });

  app.get('/users', async (request) => {
    const query = parseWith(
      z.object({
        search: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      request.query,
    );

    const search = query.search?.toLowerCase();
    const where = search
      ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`))
      : undefined;

    const db = getDb();
    const [totalRow] = await db.select({ total: count() }).from(users).where(where);
    const [rcRow] = await db
      .select({ totalRc: sql<string>`coalesce(sum(${wallets.totalCredits}), 0)` })
      .from(wallets);

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        totalCredits: wallets.totalCredits,
        usedCredits: wallets.usedCredits,
        reservedCredits: wallets.reservedCredits,
        expiresAt: wallets.expiresAt,
      })
      .from(users)
      .leftJoin(wallets, eq(users.id, wallets.userId))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    return {
      data: rows.map((row) => {
        const { totalCredits, usedCredits, reservedCredits, expiresAt, ...rest } = row;
        return {
          ...rest,
          wallet: serializeWallet(
            totalCredits == null
              ? null
              : {
                  userId: row.id,
                  totalCredits,
                  usedCredits: usedCredits ?? 0n,
                  reservedCredits: reservedCredits ?? 0n,
                  expiresAt,
                  updatedAt: new Date(),
                },
          ),
        };
      }),
      meta: {
        page: query.page,
        limit: query.limit,
        total: totalRow?.total ?? 0,
        totalRc: rcRow?.totalRc ?? '0',
      },
    };
  });

  app.post('/users/:id/quota', async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();

    const { id } = parseWith(z.object({ id: z.string().uuid() }), request.params);
    const input = parseWith(
      z.object({
        adjustment: z.number().int().min(-1_000_000_000).max(1_000_000_000),
        note: z.string().trim().max(500).optional(),
      }),
      request.body,
    );
    if (input.adjustment === 0) throw badRequest('Adjustment tidak boleh 0');

    const result = await getDb().transaction(async (tx) => {
      const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, id)).for('update');
      if (!wallet) throw notFound('Wallet pengguna tidak ditemukan');

      const delta = BigInt(input.adjustment);
      const nextTotal = wallet.totalCredits + delta;
      if (nextTotal < 0n) throw badRequest('Total RC tidak boleh negatif');
      if (nextTotal < wallet.usedCredits + wallet.reservedCredits) {
        throw badRequest('Total RC tidak boleh lebih kecil dari RC terpakai + tereservasi');
      }

      const [updated] = await tx
        .update(wallets)
        .set({ totalCredits: nextTotal, updatedAt: new Date() })
        .where(eq(wallets.userId, id))
        .returning();

      const [adjustment] = await tx
        .insert(quotaAdjustments)
        .values({
          userId: id,
          amount: delta,
          reason: input.note?.trim() || 'Penyesuaian manual admin',
        })
        .returning({ id: quotaAdjustments.id });

      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        action: 'wallet.adjust',
        resourceType: 'wallet',
        resourceId: id,
        metadata: {
          adjustment: input.adjustment,
          note: input.note ?? null,
          quotaAdjustmentId: adjustment?.id ?? null,
        },
      });

      return updated;
    });

    if (!result) throw notFound('Wallet pengguna tidak ditemukan');
    return { data: { wallet: serializeWallet(result) } };
  });

  app.post('/users', async (request, reply) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();
    const input = parseWith(
      z.object({
        email: emailSchema,
        password: passwordSchema,
        name: z.string().trim().min(1).max(80),
        role: z.enum(['customer', 'admin']).default('customer'),
      }),
      request.body,
    );

    const email = input.email.toLowerCase();
    const existing = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing[0]) throw conflict('Email sudah terdaftar');

    const passwordHash = await hash(input.password, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    const [created] = await getDb()
      .insert(users)
      .values({
        email,
        passwordHash,
        name: input.name,
        role: input.role,
        status: 'active',
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
      });
    if (!created) throw new Error('failed to create user');

    await getDb().insert(wallets).values({ userId: created.id });
    await writeAudit({
      actorUserId: actor.id,
      action: 'user.create',
      resourceType: 'user',
      resourceId: created.id,
    });

    reply.code(201);
    return { data: created };
  });

  app.get('/usage', async (request) => {
    const query = parseWith(
      z.object({
        status: z
          .enum([
            'pending',
            'reserved',
            'skipped',
            'finalized',
            'reconciliation',
            'failed',
            'insufficient_quota',
          ])
          .optional(),
        userId: z.string().uuid().optional(),
        model: z.string().min(1).max(128).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      request.query,
    );

    const conditions = [];
    if (query.status) conditions.push(eq(usageLogs.status, query.status));
    if (query.userId) conditions.push(eq(usageLogs.userId, query.userId));
    if (query.model) conditions.push(eq(usageLogs.modelId, query.model));
    if (query.from) conditions.push(gte(usageLogs.createdAt, query.from));
    if (query.to) conditions.push(lte(usageLogs.createdAt, query.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [totalRow] = await getDb().select({ total: count() }).from(usageLogs).where(where);

    const rows = await getDb()
      .select({ log: usageLogs, userEmail: users.email })
      .from(usageLogs)
      .leftJoin(users, eq(users.id, usageLogs.userId))
      .where(where)
      .orderBy(desc(usageLogs.createdAt))
      .limit(query.limit);

    return {
      data: rows.map(({ log, userEmail }) => ({
        ...log,
        userEmail,
        tokensBilled: log.tokensBilled.toString(),
        tokensReserved: log.tokensReserved.toString(),
        creditsDeducted: log.creditsDeducted.toString(),
        creditsReserved: log.creditsReserved.toString(),
      })),
      total: totalRow?.total ?? 0,
    };
  });

  app.post('/usage/reconcile-expired', async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();
    const result = await reconcileExpiredReservations(100);
    await writeAudit({
      actorUserId: actor.id,
      action: 'usage.reconcile_expired',
      resourceType: 'usage_log',
      metadata: { released: result },
    });
    return { data: { released: result } };
  });

  app.post('/usage/:id/reconcile', async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();
    const { id } = parseWith(z.object({ id: z.string().uuid() }), request.params);
    const input = parseWith(
      z.object({
        promptTokens: z.number().int().min(0).max(2_147_483_647),
        completionTokens: z.number().int().min(0).max(2_147_483_647),
        cachedTokens: z.number().int().min(0).max(2_147_483_647).optional(),
        note: z.string().trim().min(3).max(500).optional(),
      }),
      request.body,
    );

    const result = await reconcileUsage(
      id,
      input,
      actor.id,
      input.note ?? 'Rekonsiliasi manual admin',
    );
    return {
      data: {
        ...result,
        creditsDeducted: result.creditsDeducted.toString(),
        tokensBilled: result.tokensBilled.toString(),
        shortfall: result.shortfall.toString(),
      },
    };
  });

  app.get('/settings', async () => {
    const keys = Object.values(SETTINGS_KEYS);
    const rows = await Promise.all(
      keys.map(async (key) => ({
        key,
        value: await getSetting(key, null),
      })),
    );
    return { data: rows };
  });

  app.get('/health/upstream', async (request) => {
    const cached = upstreamHealthCache;
    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.result, cached: true };
    }

    const result = await checkUpstreamHealth();
    upstreamHealthCache = { result, expiresAt: Date.now() + UPSTREAM_HEALTH_CACHE_MS };

    request.log.info(
      {
        status: result.status,
        latencyMs: result.latencyMs,
        model: result.model,
        httpStatus: result.details.httpStatus,
        hasUsage: result.details.hasUsage,
        hasChoices: result.details.hasChoices,
        completionTokens: result.details.completionTokens,
        error: result.error,
      },
      'upstream health check',
    );

    return result;
  });

  app.get('/quota', async () => {
    const quota = await bankai.getQuota();
    return { data: quota.body };
  });

  app.post('/monitor/check-now', async (request) => {
    const checks = await Promise.allSettled([checkQuota(), checkUpstream(), checkReconciliation()]);

    for (const check of checks) {
      if (check.status === 'rejected') {
        request.log.error({ err: check.reason }, 'manual monitor check failed');
      }
    }

    return { triggered: true, timestamp: new Date().toISOString() };
  });

  app.post('/monitor/test-telegram', async () => {
    const timestamp = new Date().toISOString();
    return sendTelegram(
      `<h3>🧪 Test Notifikasi Rexu</h3>
<table>
  <tr><th>Parameter</th><th>Detail</th></tr>
  <tr><td><b>Status</b></td><td><mark>CONNECTED</mark></td></tr>
  <tr><td><b>Format</b></td><td><code>Telegram Rich HTML</code></td></tr>
  <tr><td><b>Waktu</b></td><td><code>${timestamp}</code></td></tr>
</table>
<details>
  <summary>ℹ️ <b>Info Konfigurasi</b></summary>
  <p>Jika kamu menerima pesan tabel ini, integrasi Telegram Rich Message pada Rexu API sudah berjalan dengan benar.</p>
</details>`,
    );
  });
}
