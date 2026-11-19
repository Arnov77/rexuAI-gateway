import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const models = pgTable(
  'models',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    provider: text('provider').notNull().default('bankai'),
    description: text('description'),
    multiplierBp: integer('multiplier_bp'),
    bankaiMultiplierBp: integer('bankai_multiplier_bp').notNull().default(10000),
    /** NULL = formula 2048 x bankai multiplier; diisi = pakai nilai ini. */
    minBlockOverride: integer('min_block_override'),
    isEnabled: boolean('is_enabled').notNull().default(false),
    isAvailable: boolean('is_available').notNull().default(true),
    vision: boolean('vision').notNull().default(false),
    streaming: boolean('streaming').notNull().default(false),
    category: text('category'),
    contextWindow: integer('context_window'),
    inputModalities: jsonb('input_modalities')
      .$type<string[]>()
      .notNull()
      .default(sql`'["text"]'::jsonb`),
    outputModalities: jsonb('output_modalities')
      .$type<string[]>()
      .notNull()
      .default(sql`'["text"]'::jsonb`),
    upstreamMetadata: jsonb('upstream_metadata').$type<Record<string, unknown>>(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'models_enabled_requires_multiplier',
      sql`NOT ${table.isEnabled} OR ${table.multiplierBp} IS NOT NULL`,
    ),
    check(
      'models_multiplier_positive',
      sql`${table.multiplierBp} IS NULL OR ${table.multiplierBp} > 0`,
    ),
    check('models_bankai_multiplier_non_negative', sql`${table.bankaiMultiplierBp} >= 0`),
  ],
);
