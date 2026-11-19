import { loadEnv } from '@rexu/db';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32),
  API_KEY_PEPPER: z.string().min(32),
  BANKAI_BASE_URL: z.string().url().default('https://bankai.web.id/api'),
  BANKAI_API_KEY: z.string().min(1),
  BANKAI_CHAT_PATH: z.string().default('/chat/completions'),
  BANKAI_MODELS_PATH: z.string().default('/v1/models'),
  BANKAI_QUOTA_PATH: z.string().default('/v1/quota'),
  BANKAI_AUTH_HEADER: z.string().default('authorization'),
  BANKAI_AUTH_SCHEME: z.string().default('Bearer'),
  BANKAI_STREAM_USAGE: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
  BANKAI_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  BANKAI_STREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  BILLING_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  BILLING_RESERVATION_TTL_MS: z.coerce.number().int().positive().default(600_000),
  BILLING_MAX_RESERVE: z.coerce.number().int().positive().default(1_000_000),
  BILLING_UPSTREAM_PARITY_VERIFIED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  MIDTRANS_SERVER_KEY: z.string().min(1),
  MIDTRANS_CLIENT_KEY: z.string().min(1),
  MIDTRANS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  SKYMAIL_API_URL: z.string().url(),
  SKYMAIL_TOKEN: z.string().min(1),
  SKYMAIL_ACCOUNT_ID: z.coerce.number().int(),
  SKYMAIL_SENDER_NAME: z.string().default('Rexu'),
  SKYMAIL_SENDER_FROM: z.string().email(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_THREAD_ID: z.string().optional(),
  MONITOR_QUOTA_INTERVAL_MS: z.coerce.number().default(900_000),
  MONITOR_UPSTREAM_INTERVAL_MS: z.coerce.number().default(1_800_000),
  MONITOR_RECONCILE_INTERVAL_MS: z.coerce.number().default(3_600_000),
  MONITOR_QUOTA_WARN_PCT: z.coerce.number().default(80),
  MONITOR_QUOTA_CRITICAL_PCT: z.coerce.number().default(90),
  MONITOR_RECONCILE_PENDING_HOURS: z.coerce.number().default(6),
  LOG_LEVEL: z.string().default('info'),
  TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  // Jumlah hop proxy yang dipercaya. 1 = percaya tepat satu hop (nginx langsung),
  // 0 = tidak percaya proxy sama sekali. Jangan gunakan `true` karena Fastify akan
  // mempercayai seluruh rantai X-Forwarded-For yang bisa dipalsukan client.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment: ${missing}`);
}

const raw = parsed.data;

if (raw.BILLING_ENABLED && !raw.BILLING_UPSTREAM_PARITY_VERIFIED) {
  throw new Error(
    'BILLING_ENABLED requires BILLING_UPSTREAM_PARITY_VERIFIED=true after upstream quota parity is verified',
  );
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  sessionTtlDays: 30,
  cookieName: 'rexu_session',
  bankaiBaseUrl: raw.BANKAI_BASE_URL.replace(/\/+$/, ''),
  bankaiChatUrl: `${raw.BANKAI_BASE_URL.replace(/\/+$/, '')}${raw.BANKAI_CHAT_PATH}`,
  bankaiModelsUrl: `${raw.BANKAI_BASE_URL.replace(/\/+$/, '')}${raw.BANKAI_MODELS_PATH}`,
  bankaiQuotaUrl: `${raw.BANKAI_BASE_URL.replace(/\/+$/, '')}${raw.BANKAI_QUOTA_PATH}`,
};
