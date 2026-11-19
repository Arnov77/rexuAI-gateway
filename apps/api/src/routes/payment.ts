import { getDb, schema } from '@rexu/db';
import { and, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { unauthorized } from '../lib/errors.js';
import { verifyWebhookSignature } from '../lib/midtrans.js';
import { parseWith } from '../lib/validate.js';
import {
  cancelOrder,
  createOrder,
  getOrderStatus,
  MIN_AMOUNT_IDR,
  processPayment,
  setOrderTerminalStatus,
  syncOrderStatus,
  TERMINAL_STATUS,
} from '../modules/payment/service.js';

const { orders, paymentWebhookEvents } = schema;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhook', async (request, reply) => {
    const body = asRecord(request.body);
    const orderId = asString(body.order_id);
    const statusCode = asString(body.status_code);
    const grossAmount = asString(body.gross_amount);
    const signatureKey = asString(body.signature_key);
    const transactionStatus = asString(body.transaction_status);
    const transactionId = asString(body.transaction_id);
    const paymentType = asString(body.payment_type) || undefined;
    const fraudStatus = asString(body.fraud_status) || undefined;

    request.log.info(
      {
        orderId,
        transactionId,
        transactionStatus,
        statusCode,
        grossAmount,
        paymentType: asString(body.payment_type),
      },
      'midtrans webhook received',
    );

    if (
      !orderId ||
      !statusCode ||
      !grossAmount ||
      !signatureKey ||
      !verifyWebhookSignature({
        order_id: orderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        signature_key: signatureKey,
      })
    ) {
      request.log.warn({ orderId, transactionStatus }, 'midtrans webhook invalid signature');
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const eventId = `${orderId}:${transactionId || 'na'}:${transactionStatus}:${statusCode}`;
    const db = getDb();

    try {
      await db
        .insert(paymentWebhookEvents)
        .values({
          provider: 'midtrans',
          eventId,
          status: 'received',
          payload: body,
        })
        .onConflictDoNothing();

      let eventStatus: 'processed' | 'ignored' = 'ignored';

      if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
        const result = await processPayment(orderId, body, {
          grossAmount,
          paymentType,
          transactionStatus,
          fraudStatus: fraudStatus ?? null,
          logger: request.log,
        });
        eventStatus = result.status === 'paid' ? 'processed' : 'ignored';
      } else {
        const terminalStatus = TERMINAL_STATUS[transactionStatus];
        if (terminalStatus) {
          await setOrderTerminalStatus(orderId, terminalStatus, body);
          eventStatus = 'processed';
        }
      }

      await db
        .update(paymentWebhookEvents)
        .set({
          status: eventStatus,
          processedAt: new Date(),
          payload: body,
        })
        .where(
          and(
            eq(paymentWebhookEvents.provider, 'midtrans'),
            eq(paymentWebhookEvents.eventId, eventId),
          ),
        );

      request.log.info({ orderId, transactionStatus, eventStatus }, 'midtrans webhook handled');
      return reply.status(200).send({ ok: true });
    } catch (error) {
      request.log.error({ err: error, orderId, transactionStatus }, 'midtrans webhook failed');
      await db
        .update(paymentWebhookEvents)
        .set({ status: 'failed', processedAt: new Date(), payload: body })
        .where(
          and(
            eq(paymentWebhookEvents.provider, 'midtrans'),
            eq(paymentWebhookEvents.eventId, eventId),
          ),
        )
        .catch(() => undefined);
      return reply.status(500).send({ ok: false });
    }
  });

  app.post('/create', { preHandler: requireUser }, async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();

    const input = parseWith(
      z.object({
        packageId: z.string().uuid().optional(),
        amountIdr: z.number().int().min(MIN_AMOUNT_IDR).max(2_147_483_647),
        rcAmount: z.number().int().positive().max(2_147_483_647).optional(),
      }),
      request.body,
    );

    return createOrder({
      userId: actor.id,
      packageId: input.packageId ?? null,
      amountIdr: input.amountIdr,
      rcAmount: input.rcAmount,
      customerEmail: actor.email,
      customerName: actor.name,
      logger: request.log,
    });
  });

  app.get('/orders', { preHandler: requireUser }, async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();

    const query = parseWith(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
      }),
      request.query,
    );

    const pageSize = 10;
    const db = getDb();

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: orders.id,
          packageName: orders.packageName,
          amountIdr: orders.priceIdr,
          rcAmount: orders.tokenAmount,
          status: orders.status,
          paymentType: orders.paymentType,
          midtransOrderId: orders.providerRef,
          qrImageUrl: orders.qrImageUrl,
          expiresAt: orders.expiresAt,
          paidAt: orders.paidAt,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(eq(orders.userId, actor.id))
        .orderBy(desc(orders.createdAt))
        .limit(pageSize)
        .offset((query.page - 1) * pageSize),
      db.select({ total: count() }).from(orders).where(eq(orders.userId, actor.id)),
    ]);

    return {
      data: rows.map((row) => ({
        ...row,
        amountIdr: Number(row.amountIdr),
        rcAmount: Number(row.rcAmount),
      })),
      total: totalRows[0]?.total ?? 0,
      page: query.page,
      pageSize,
    };
  });

  app.get('/:orderId/status', { preHandler: requireUser }, async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();

    const { orderId } = parseWith(z.object({ orderId: z.string().uuid() }), request.params);
    const current = await getOrderStatus(orderId, actor.id);

    if (current.status === 'pending') {
      try {
        await syncOrderStatus(orderId, actor.id);
      } catch (error) {
        request.log.warn({ err: error, orderId }, 'midtrans status poll failed');
      }
    }

    return getOrderStatus(orderId, actor.id);
  });

  app.post('/:orderId/cancel', { preHandler: requireUser }, async (request) => {
    const actor = request.authUser;
    if (!actor) throw unauthorized();

    const { orderId } = parseWith(z.object({ orderId: z.string().uuid() }), request.params);
    return cancelOrder(orderId, actor.id);
  });
}
