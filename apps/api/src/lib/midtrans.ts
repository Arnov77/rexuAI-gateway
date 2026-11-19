import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const MIDTRANS_BASE_URL =
  env.MIDTRANS_ENV === 'production'
    ? 'https://api.midtrans.com'
    : 'https://api.sandbox.midtrans.com';

const CHARGE_TIMEOUT_MS = 20_000;
const STATUS_TIMEOUT_MS = 15_000;

export type QrisCharge = {
  transactionId: string;
  qrString: string;
  qrImageUrl: string;
  expiresAt: Date;
};

export type MidtransTransactionStatus = {
  transactionStatus: string;
  fraudStatus: string | null;
  transactionId: string | null;
  orderId: string | null;
  grossAmount: string | null;
  statusCode: string | null;
  raw: Record<string, unknown>;
};

function getAuthHeader(): string {
  return `Basic ${Buffer.from(`${env.MIDTRANS_SERVER_KEY}:`).toString('base64')}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toTransactionStatus(data: Record<string, unknown>): MidtransTransactionStatus {
  return {
    transactionStatus: asString(data.transaction_status) ?? 'unknown',
    fraudStatus: asString(data.fraud_status),
    transactionId: asString(data.transaction_id),
    orderId: asString(data.order_id),
    grossAmount: asString(data.gross_amount),
    statusCode: asString(data.status_code),
    raw: data,
  };
}

export async function createQrisCharge(params: {
  orderId: string;
  amountIdr: number;
  customerEmail: string;
  customerName: string;
}): Promise<QrisCharge> {
  const response = await fetch(`${MIDTRANS_BASE_URL}/v2/charge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify({
      payment_type: 'qris',
      transaction_details: {
        order_id: params.orderId,
        gross_amount: Math.round(params.amountIdr),
      },
      qris: {
        acquirer: 'gopay',
      },
      customer_details: {
        email: params.customerEmail,
        first_name: params.customerName,
      },
    }),
    signal: AbortSignal.timeout(CHARGE_TIMEOUT_MS),
  });

  const data = asRecord(await response.json().catch(() => ({})));
  const statusCode = asString(data.status_code);

  if (!response.ok || (statusCode != null && statusCode !== '201' && statusCode !== '200')) {
    const message =
      asString(data.status_message) ?? `Midtrans menolak transaksi (HTTP ${response.status})`;
    const error = new Error(message) as Error & { midtrans?: Record<string, unknown> };
    error.midtrans = data;
    throw error;
  }

  const actions = Array.isArray(data.actions) ? data.actions.map(asRecord) : [];
  const qrAction = actions.find((action) => action.name === 'generate-qr-code');
  const qrImageUrl = asString(qrAction?.url) ?? '';
  const qrString = asString(data.qr_string) ?? '';
  const transactionId = asString(data.transaction_id);

  if (!transactionId) {
    throw new Error('Midtrans tidak mengembalikan transaction_id');
  }

  if (!qrImageUrl && !qrString) {
    throw new Error('Midtrans tidak mengembalikan QR pembayaran');
  }

  return {
    transactionId,
    qrString,
    qrImageUrl,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  };
}

export async function checkTransactionStatus(orderId: string): Promise<MidtransTransactionStatus> {
  const response = await fetch(`${MIDTRANS_BASE_URL}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: {
      Accept: 'application/json',
      Authorization: getAuthHeader(),
    },
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  });

  const data = asRecord(await response.json().catch(() => ({})));

  if (!response.ok) {
    const message =
      asString(data.status_message) ?? `Gagal cek status Midtrans (HTTP ${response.status})`;
    const error = new Error(message) as Error & { midtrans?: Record<string, unknown> };
    error.midtrans = data;
    throw error;
  }

  return toTransactionStatus(data);
}

export async function cancelTransaction(orderId: string): Promise<MidtransTransactionStatus> {
  const response = await fetch(`${MIDTRANS_BASE_URL}/v2/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: getAuthHeader(),
    },
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  });

  const data = asRecord(await response.json().catch(() => ({})));

  if (!response.ok) {
    const message =
      asString(data.status_message) ??
      `Gagal membatalkan transaksi Midtrans (HTTP ${response.status})`;
    const error = new Error(message) as Error & { midtrans?: Record<string, unknown> };
    error.midtrans = data;
    throw error;
  }

  return toTransactionStatus(data);
}

export function verifyWebhookSignature(payload: {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
}): boolean {
  const expected = createHash('sha512')
    .update(
      `${payload.order_id}${payload.status_code}${payload.gross_amount}${env.MIDTRANS_SERVER_KEY}`,
    )
    .digest('hex');

  const received = payload.signature_key.toLowerCase();
  if (received.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
  } catch {
    return false;
  }
}
