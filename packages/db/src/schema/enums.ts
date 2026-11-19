import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['customer', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);
export const apiKeyStatus = pgEnum('api_key_status', ['active', 'revoked']);
export const usageSource = pgEnum('usage_source', ['playground', 'api']);
export const billingStatus = pgEnum('billing_status', [
  'pending',
  'reserved',
  'skipped',
  'finalized',
  'reconciliation',
  'failed',
  'insufficient_quota',
]);
export const transactionType = pgEnum('transaction_type', [
  'manual_topup',
  'package_purchase',
  'refund',
  'admin_adjustment',
]);
export const transactionStatus = pgEnum('transaction_status', [
  'pending',
  'paid',
  'failed',
  'expired',
  'cancelled',
]);
export const orderStatus = pgEnum('order_status', [
  'pending',
  'paid',
  'failed',
  'expired',
  'cancelled',
]);
export const messageRole = pgEnum('message_role', ['system', 'user', 'assistant', 'tool']);
export const webhookStatus = pgEnum('webhook_status', [
  'received',
  'processed',
  'ignored',
  'failed',
]);
