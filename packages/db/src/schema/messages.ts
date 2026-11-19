import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { usageLogs } from './billing.js';
import { models } from './catalog.js';
import { conversations } from './chat.js';
import { messageRole } from './enums.js';

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    content: jsonb('content').$type<unknown>().notNull(),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    usageLogId: uuid('usage_log_id').references(() => usageLogs.id, {
      onDelete: 'set null',
    }),
    sequence: integer('sequence').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('messages_conversation_sequence_uq').on(table.conversationId, table.sequence),
    index('messages_conversation_created_idx').on(table.conversationId, table.createdAt),
  ],
);
