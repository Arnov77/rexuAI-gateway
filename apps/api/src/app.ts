import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { closeDb, getDb } from '@rexu/db';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { errorHandler } from './lib/error-handler.js';
import { forbidden } from './lib/errors.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { paymentRoutes } from './routes/payment.js';
import { userRoutes } from './routes/user.js';
import { v1Routes } from './routes/v1.js';

const devOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:21072',
  'http://127.0.0.1:21072',
  'http://localhost:3001',
];

const allowedOrigins = [
  ...new Set([env.APP_URL, ...env.TRUSTED_ORIGINS, ...(env.isProduction ? [] : devOrigins)]),
];

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
    },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 12 * 1024 * 1024,
    requestIdHeader: 'x-request-id',
  });

  app.decorateRequest('authUser', null);
  app.decorateRequest('apiKeyAuth', null);

  await app.register(cookie);
  await app.register(helmet);
  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
  });

  app.addHook('onRequest', async (request) => {
    const method = request.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
    if (!request.url.startsWith('/api/')) return;

    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      throw forbidden('Origin tidak diizinkan');
    }
  });

  app.setErrorHandler(errorHandler);

  app.get('/healthz', async () => ({
    ok: true,
    service: 'rexu-api',
    environment: env.NODE_ENV,
  }));

  app.get('/readyz', async () => {
    await getDb().execute(sql`select 1`);
    return { ok: true, database: 'up' };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/user' });
  await app.register(paymentRoutes, { prefix: '/api/payment' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(v1Routes, { prefix: '/v1' });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        message: 'Endpoint tidak ditemukan',
        type: 'invalid_request_error',
        code: 'not_found',
        request_id: request.id,
      },
    });
  });

  app.addHook('onClose', async () => {
    await closeDb();
  });

  return app;
}
