import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { models } from './catalog.js';
import { conversations } from './chat.js';
import { transactions } from './commerce.js';
import { billingStatus, usageSource } from './enums.js';
import { apiKeys, users } from './identity.js';

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    source: usageSource('source').notNull(),
    status: billingStatus('status').notNull().default('pending'),
    upstreamRequestId: text('upstream_request_id'),
    idempotencyKey: text('idempotency_key'),
    httpStatus: integer('http_status'),
    isStream: boolean('is_stream').notNull().default(false),
    rawTokens: integer('raw_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    contextTokens: integer('context_tokens').notNull().default(0),
    generationTokens: integer('generation_tokens').notNull().default(0),
    multiplierBp: integer('multiplier_bp'),
    bankaiMultiplierBp: integer('bankai_multiplier_bp'),
    /** Snapshot minimum block yang dipakai saat request dibuat (audit). */
    effectiveMinBlock: integer('effective_min_block'),
    tokensBilled: bigint('tokens_billed', { mode: 'bigint' }).notNull().default(sql`0`),
    tokensReserved: bigint('tokens_reserved', { mode: 'bigint' }).notNull().default(sql`0`),
    creditsDeducted: bigint('credits_deducted', { mode: 'bigint' }).notNull().default(sql`0`),
    creditsReserved: bigint('credits_reserved', { mode: 'bigint' }).notNull().default(sql`0`),
    reservedAt: timestamp('reserved_at', { withTimezone: true }),
    reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true }),
    latencyMs: integer('latency_ms'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('usage_logs_user_idem_uq')
      .on(table.userId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex('usage_logs_key_upstream_uq')
      .on(table.apiKeyId, table.upstreamRequestId)
      .where(sql`${table.upstreamRequestId} IS NOT NULL`),
    index('usage_logs_user_created_idx').on(table.userId, table.createdAt),
    index('usage_logs_status_idx').on(table.status, table.createdAt),
    index('usage_logs_reservation_expiry_idx').on(table.status, table.reservationExpiresAt),
    check('usage_logs_tokens_non_negative', sql`${table.rawTokens} >= 0`),
    check('usage_logs_tokens_reserved_non_negative', sql`${table.tokensReserved} >= 0`),
    check('usage_logs_credits_deducted_non_negative', sql`${table.creditsDeducted} >= 0`),
    check('usage_logs_credits_reserved_non_negative', sql`${table.creditsReserved} >= 0`),
  ],
);

export const quotaAdjustments = pgTable(
  'quota_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quota_adjustments_txn_uq').on(table.transactionId),
    index('quota_adjustments_user_idx').on(table.userId, table.createdAt),
    check('quota_adjustments_non_zero', sql`${table.amount} <> 0`),
  ],
);
