import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { models } from './catalog.js';
import { users } from './identity.js';

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    defaultModelId: text('default_model_id').references(() => models.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('conversations_user_idx').on(table.userId, table.updatedAt)],
);
