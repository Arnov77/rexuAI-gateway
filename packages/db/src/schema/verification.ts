import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /** Kode OTP 6 digit, disimpan sebagai hash argon2. */
    otp: text('otp').notNull(),
    type: text('type').notNull().default('register'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('email_verifications_email_type_idx').on(table.email, table.type)],
);
