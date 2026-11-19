import { randomBytes } from 'node:crypto';
import { getDb, schema } from '@rexu/db';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../../config/env.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import {
  cancelTransaction,
  checkTransactionStatus,
  createQrisCharge,
  type MidtransTransactionStatus,
} from '../../lib/midtrans.js';

const { auditLogs, orders, quotaAdjustments, tokenPackages, transactions, users, wallets } = schema;

const MIN_AMOUNT_IDR = 2_000;

type OrderRow = typeof orders.$inferSelect;

export type CreateOrderResult = {
  orderId: string;
  midtransOrderId: string;
  amountIdr: number;
  rcAmount: number;
  qrString: string;
  qrImageUrl: string;
  expiresAt: Date;
  status: string;
};

export type OrderStatusResult = {
  orderId: string;
  midtransOrderId: string | null;
  status: string;
  amountIdr: number;
  rcAmount: number;
  paidAt: Date | null;
  expiresAt: Date;
  remainingRc: string;
};

/** Rate konversi nominal custom. Harus sama dengan helper di TopupPage. */
export function getRcForAmount(idr: number): number | null {
  if (!Number.isFinite(idr) || !Number.isInteger(idr) || idr < MIN_AMOUNT_IDR) return null;
  if (idr < 5_000) return Math.floor((idr * 6_500) / 2_000);
  if (idr < 10_000) return Math.floor((idr * 16_500) / 5_000);
  if (idr < 20_000) return Math.floor((idr * 33_500) / 10_000);
  if (idr < 50_000) return Math.floor((idr * 67_500) / 20_000);
  if (idr < 100_000) return Math.floor((idr * 170_000) / 50_000);
  return Math.floor((idr * 350_000) / 100_000);
}

function generateMidtransOrderId(): string {
  const suffix = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  return `RXU-${Date.now()}-${suffix}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function orderAmount(order: OrderRow): number {
  return Number(order.priceIdr);
}

function orderRc(order: OrderRow): number {
  return Number(order.tokenAmount);
}

export async function createOrder(params: {
  userId: string;
  packageId: string | null;
  amountIdr: number;
  rcAmount?: number;
  customerEmail: string;
  customerName: string;
  logger: FastifyBaseLogger;
}): Promise<CreateOrderResult> {
  if (!Number.isInteger(params.amountIdr) || params.amountIdr < MIN_AMOUNT_IDR) {
    throw badRequest(`Nominal minimal Rp ${MIN_AMOUNT_IDR.toLocaleString('id-ID')}`);
  }

  const db = getDb();

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, status: users.status })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);

  if (!user) throw notFound('User tidak ditemukan');
  if (user.status !== 'active') throw badRequest('Akun tidak aktif');

  let packageRow: typeof tokenPackages.$inferSelect | null = null;
  if (params.packageId) {
    const [found] = await db
      .select()
      .from(tokenPackages)
      .where(and(eq(tokenPackages.id, params.packageId), eq(tokenPackages.isActive, true)))
      .limit(1);
    if (!found) throw badRequest('Paket tidak ditemukan atau sudah tidak aktif');
    packageRow = found;
  }

  const amountIdr = packageRow ? Number(packageRow.priceIdr) : params.amountIdr;
  const rcAmount = packageRow ? Number(packageRow.tokenAmount) : getRcForAmount(amountIdr);

  if (rcAmount == null || !Number.isInteger(rcAmount) || rcAmount <= 0) {
    throw badRequest('Jumlah RC tidak valid');
  }

  const midtransOrderId = generateMidtransOrderId();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const [created] = await db
    .insert(orders)
    .values({
      userId: params.userId,
      packageId: packageRow?.id ?? null,
      packageName: packageRow?.name ?? `Custom Rp ${amountIdr.toLocaleString('id-ID')}`,
      tokenAmount: BigInt(rcAmount),
      priceIdr: BigInt(amountIdr),
      status: 'pending',
      provider: 'midtrans',
      providerRef: midtransOrderId,
      paymentType: 'qris',
      expiresAt,
    })
    .returning();

  if (!created) throw new Error('failed to create order');

  let charge: Awaited<ReturnType<typeof createQrisCharge>>;
  try {
    charge = await createQrisCharge({
      orderId: midtransOrderId,
      amountIdr,
      customerEmail: user.email,
      customerName: user.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membuat QRIS';
    await db
      .update(orders)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(orders.id, created.id));
    throw new AppError(502, 'upstream_error', `Gagal membuat QRIS: ${message}`, {
      type: 'upstream_error',
    });
  }

  if (env.MIDTRANS_ENV === 'sandbox') {
    params.logger.info(
      {
        midtransOrderId,
        qrImageUrl: charge.qrImageUrl,
        qrString: charge.qrString,
        amountIdr,
        expiresAt: charge.expiresAt,
      },
      'SANDBOX: QR code created',
    );
  }

  await db
    .update(orders)
    .set({
      midtransTransactionId: charge.transactionId,
      qrString: charge.qrString,
      qrImageUrl: charge.qrImageUrl,
      expiresAt: charge.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, created.id));

  return {
    orderId: created.id,
    midtransOrderId,
    amountIdr,
    rcAmount,
    qrString: charge.qrString,
    qrImageUrl: charge.qrImageUrl,
    expiresAt: charge.expiresAt,
    status: 'pending',
  };
}

export type ProcessPaymentOptions = {
  grossAmount?: string;
  paymentType?: string;
  transactionStatus?: string;
  fraudStatus?: string | null;
  logger?: FastifyBaseLogger;
};

function warnProcessPayment(
  logger: FastifyBaseLogger | undefined,
  data: Record<string, unknown>,
  message: string,
): void {
  if (logger) logger.warn(data, message);
  else console.warn(message, data);
}

/**
 * Menandai order lunas, menambah saldo RC, dan menulis audit trail.
 * Idempotent: order yang sudah paid tidak diproses ulang.
 *
 * options dipakai untuk memvalidasi payload webhook (nominal, metode, fraud)
 * sebelum status order diubah.
 */
export async function processPayment(
  midtransOrderId: string,
  webhookPayload: unknown,
  options: ProcessPaymentOptions = {},
): Promise<{ processed: boolean; status: string }> {
  const payload = asRecord(webhookPayload);

  return getDb().transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.providerRef, midtransOrderId))
      .limit(1)
      .for('update');

    if (!order) return { processed: false, status: 'not_found' };
    if (order.status === 'paid') return { processed: false, status: 'paid' };
    if (order.status !== 'pending') return { processed: false, status: order.status };

    // Validasi gross_amount: nominal yang dibayar harus sama dengan harga order.
    if (options.grossAmount !== undefined) {
      const paidAmount = Math.round(Number.parseFloat(options.grossAmount));
      const expectedAmount = orderAmount(order);
      if (!Number.isFinite(paidAmount) || paidAmount !== expectedAmount) {
        warnProcessPayment(
          options.logger,
          { midtransOrderId, grossAmount: options.grossAmount, paidAmount, expectedAmount },
          'gross_amount mismatch — webhook diabaikan',
        );
        return { processed: false, status: 'amount_mismatch' };
      }
    }

    // Order Rexu hanya dibuat dengan QRIS.
    if (options.paymentType !== undefined && options.paymentType !== 'qris') {
      warnProcessPayment(
        options.logger,
        { midtransOrderId, paymentType: options.paymentType },
        'payment_type tidak sesuai — webhook diabaikan',
      );
      return { processed: false, status: 'payment_type_mismatch' };
    }

    // Untuk transaksi capture, fraud_status harus accept.
    if (options.transactionStatus === 'capture' && options.fraudStatus !== 'accept') {
      warnProcessPayment(
        options.logger,
        { midtransOrderId, fraudStatus: options.fraudStatus },
        'fraud_status bukan accept — webhook diabaikan',
      );
      return { processed: false, status: 'fraud_status_rejected' };
    }

    const paidAt = new Date();
    const midtransTransactionId = asString(payload.transaction_id) ?? order.midtransTransactionId;

    await tx
      .update(orders)
      .set({
        status: 'paid',
        paidAt,
        midtransTransactionId,
        webhookPayload: payload,
        updatedAt: paidAt,
      })
      .where(eq(orders.id, order.id));

    const [transaction] = await tx
      .insert(transactions)
      .values({
        userId: order.userId,
        type: order.packageId ? 'package_purchase' : 'manual_topup',
        status: 'paid',
        amountIdr: order.priceIdr,
        tokens: order.tokenAmount,
        packageId: order.packageId,
        orderId: order.id,
        provider: 'midtrans',
        providerRef: midtransOrderId,
        metadata: {
          midtrans_order_id: midtransOrderId,
          midtrans_transaction_id: midtransTransactionId,
          payment_type: asString(payload.payment_type) ?? order.paymentType,
        },
        paidAt,
      })
      .returning({ id: transactions.id });

    const rcAmount = order.tokenAmount.toString();
    await tx.execute(sql`
      INSERT INTO wallets (user_id, total_credits, used_credits, reserved_credits, updated_at)
      VALUES (${order.userId}::uuid, ${rcAmount}::bigint, 0, 0, now())
      ON CONFLICT (user_id) DO UPDATE
      SET total_credits = wallets.total_credits + EXCLUDED.total_credits,
          updated_at = now()
    `);

    await tx.insert(quotaAdjustments).values({
      userId: order.userId,
      transactionId: transaction?.id ?? null,
      amount: order.tokenAmount,
      reason: `Top up QRIS ${midtransOrderId}`,
    });

    await tx.insert(auditLogs).values({
      actorUserId: order.userId,
      action: 'order.paid',
      resourceType: 'order',
      resourceId: order.id,
      metadata: {
        midtrans_order_id: midtransOrderId,
        midtrans_transaction_id: midtransTransactionId,
        amount_idr: orderAmount(order),
        rc_amount: orderRc(order),
        payment_type: asString(payload.payment_type) ?? order.paymentType,
      },
    });

    return { processed: true, status: 'paid' };
  });
}

const TERMINAL_STATUS: Record<string, 'expired' | 'cancelled' | 'failed'> = {
  expire: 'expired',
  cancel: 'cancelled',
  deny: 'failed',
  failure: 'failed',
};

/** Update status non-paid dari webhook/polling. Tidak menimpa order yang sudah paid. */
export async function setOrderTerminalStatus(
  midtransOrderId: string,
  status: 'expired' | 'cancelled' | 'failed',
  webhookPayload?: unknown,
): Promise<boolean> {
  const payload = webhookPayload == null ? undefined : asRecord(webhookPayload);
  const updated = await getDb()
    .update(orders)
    .set({
      status,
      ...(payload ? { webhookPayload: payload } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(orders.providerRef, midtransOrderId), eq(orders.status, 'pending')))
    .returning({ id: orders.id });
  return updated.length > 0;
}

async function findOwnedOrder(orderId: string, userId: string): Promise<OrderRow> {
  const [order] = await getDb()
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  if (!order) throw notFound('Order tidak ditemukan');
  return order;
}

async function remainingRc(userId: string): Promise<string> {
  const [wallet] = await getDb()
    .select({
      remaining: sql<string>`(${wallets.totalCredits} - ${wallets.usedCredits} - ${wallets.reservedCredits})::text`,
    })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return wallet?.remaining ?? '0';
}

export async function getOrderStatus(orderId: string, userId: string): Promise<OrderStatusResult> {
  const order = await findOwnedOrder(orderId, userId);
  return {
    orderId: order.id,
    midtransOrderId: order.providerRef,
    status: order.status,
    amountIdr: orderAmount(order),
    rcAmount: orderRc(order),
    paidAt: order.paidAt,
    expiresAt: order.expiresAt,
    remainingRc: await remainingRc(userId),
  };
}

/**
 * Polling status ke Midtrans untuk order yang masih pending.
 * Idempotent karena processPayment mengunci baris order.
 */
export async function syncOrderStatus(
  orderId: string,
  userId: string,
): Promise<MidtransTransactionStatus | null> {
  const order = await findOwnedOrder(orderId, userId);
  if (order.status !== 'pending' || !order.providerRef) return null;

  const status = await checkTransactionStatus(order.providerRef);

  if (status.transactionStatus === 'settlement' || status.transactionStatus === 'capture') {
    await processPayment(order.providerRef, status.raw, {
      grossAmount: status.grossAmount ?? undefined,
      transactionStatus: status.transactionStatus,
      fraudStatus: status.fraudStatus,
    });
  } else if (status.transactionStatus === 'expire') {
    await setOrderTerminalStatus(order.providerRef, 'expired', status.raw);
  } else if (status.transactionStatus === 'cancel') {
    await setOrderTerminalStatus(order.providerRef, 'cancelled', status.raw);
  } else if (status.transactionStatus === 'deny' || status.transactionStatus === 'failure') {
    await setOrderTerminalStatus(order.providerRef, 'failed', status.raw);
  } else if (order.expiresAt.getTime() <= Date.now()) {
    // Midtrans masih pending, tetapi batas waktu lokal sudah lewat.
    await setOrderTerminalStatus(order.providerRef, 'expired');
  }

  return status;
}

/**
 * Membatalkan order yang masih pending.
 * Order Midtrans dibatalkan lebih dulu agar QR tidak bisa dibayar setelah status lokal berubah.
 */
export async function cancelOrder(orderId: string, userId: string): Promise<OrderStatusResult> {
  const order = await findOwnedOrder(orderId, userId);

  if (order.status === 'paid') {
    throw badRequest('Pembayaran sudah lunas, tidak bisa dibatalkan');
  }
  if (order.status !== 'pending') {
    return getOrderStatus(orderId, userId);
  }

  if (order.provider === 'midtrans' && order.providerRef) {
    try {
      await cancelTransaction(order.providerRef);
    } catch (error) {
      // Bisa jadi transaksi sudah settlement/expire di Midtrans. Sinkronkan dulu.
      try {
        await syncOrderStatus(orderId, userId);
      } catch {
        // Abaikan kegagalan sinkronisasi; error asli yang dilaporkan.
      }

      const current = await getOrderStatus(orderId, userId);
      if (current.status !== 'pending') return current;

      const message = error instanceof Error ? error.message : 'Gagal membatalkan pembayaran';
      throw new AppError(502, 'upstream_error', `Gagal membatalkan pembayaran: ${message}`, {
        type: 'upstream_error',
      });
    }

    await setOrderTerminalStatus(order.providerRef, 'cancelled');
  } else {
    await getDb()
      .update(orders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')));
  }

  return getOrderStatus(orderId, userId);
}

export { MIN_AMOUNT_IDR, TERMINAL_STATUS };
