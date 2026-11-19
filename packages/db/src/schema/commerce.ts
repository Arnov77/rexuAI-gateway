import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { orderStatus, transactionStatus, transactionType } from './enums.js';
import { users } from './identity.js';

export const tokenPackages = pgTable(
  'token_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    tokenAmount: bigint('token_amount', { mode: 'bigint' }).notNull(),
    priceIdr: bigint('price_idr', { mode: 'bigint' }).notNull(),
    validityDays: integer('validity_days'),
    isActive: boolean('is_active').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('token_packages_amount_positive', sql`${table.tokenAmount} > 0`),
    check('token_packages_price_non_negative', sql`${table.priceIdr} >= 0`),
    check(
      'token_packages_validity_positive',
      sql`${table.validityDays} IS NULL OR ${table.validityDays} > 0`,
    ),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    packageId: uuid('package_id').references(() => tokenPackages.id, {
      onDelete: 'set null',
    }),
    packageName: text('package_name').notNull(),
    tokenAmount: bigint('token_amount', { mode: 'bigint' }).notNull(),
    priceIdr: bigint('price_idr', { mode: 'bigint' }).notNull(),
    status: orderStatus('status').notNull().default('pending'),
    /** Provider order reference. Untuk Midtrans, kolom ini berisi midtrans_order_id. */
    provider: text('provider').notNull().default('manual'),
    providerRef: text('provider_ref').unique(),
    midtransTransactionId: text('midtrans_transaction_id'),
    qrString: text('qr_string'),
    qrImageUrl: text('qr_image_url'),
    paymentType: text('payment_type').notNull().default('qris'),
    idempotencyKey: text('idempotency_key').unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    webhookPayload: jsonb('webhook_payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('orders_user_idx').on(table.userId, table.createdAt),
    index('orders_status_idx').on(table.status),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: transactionType('type').notNull(),
    status: transactionStatus('status').notNull().default('pending'),
    amountIdr: bigint('amount_idr', { mode: 'bigint' }).notNull().default(sql`0`),
    tokens: bigint('tokens', { mode: 'bigint' }).notNull().default(sql`0`),
    packageId: uuid('package_id').references(() => tokenPackages.id, {
      onDelete: 'set null',
    }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    provider: text('provider').notNull().default('manual'),
    providerRef: text('provider_ref').unique(),
    idempotencyKey: text('idempotency_key').unique(),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [
    index('transactions_user_idx').on(table.userId, table.createdAt),
    index('transactions_status_idx').on(table.status),
  ],
);
