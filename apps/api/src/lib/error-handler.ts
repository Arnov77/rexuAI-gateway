import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { BankaiError } from '../providers/bankai.js';
import { AppError } from './errors.js';

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

type SanitizedError = {
  status: number;
  code: string;
  type: string;
  message: string;
};

/**
 * Upstream error bodies can leak provider internals, account details or model
 * routing information. Each BankAI failure is mapped to a fixed, user-safe
 * message keyed by the HTTP status instead of forwarding the raw response.
 * The raw error stays on the BankaiError instance and is written to the server
 * log by the error handler for debugging.
 */
function sanitizeUpstreamStatus(status: number): SanitizedError {
  if (status === 502 || status === 503 || status === 504) {
    return {
      status,
      code: 'model_unavailable',
      type: 'upstream_error',
      message: 'Model sedang tidak tersedia. Coba lagi dalam beberapa saat.',
    };
  }
  if (status === 429) {
    return {
      status: 429,
      code: 'rate_limited',
      type: 'rate_limit_error',
      message: 'Terlalu banyak request. Tunggu sebentar lalu coba lagi.',
    };
  }
  if (status === 400) {
    return {
      status: 400,
      code: 'invalid_request',
      type: 'invalid_request_error',
      message: 'Format request tidak valid.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      status,
      code: 'unauthorized',
      type: 'authentication_error',
      message: 'Akses ditolak.',
    };
  }
  if (status === 408) {
    return {
      status: 408,
      code: 'timeout',
      type: 'upstream_error',
      message: 'Request timeout. Coba lagi dengan pesan yang lebih pendek.',
    };
  }
  return {
    status: 502,
    code: 'upstream_error',
    type: 'upstream_error',
    message: 'Terjadi kesalahan. Silakan coba lagi.',
  };
}

const upstreamTimeout: SanitizedError = {
  status: 504,
  code: 'timeout',
  type: 'upstream_error',
  message: 'Request timeout. Coba lagi dengan pesan yang lebih pendek.',
};

function isTimeoutError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'TimeoutError';
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (reply.sent || reply.raw.headersSent) return;

  let status = 500;
  let code = 'internal_error';
  let type = 'server_error';
  let message = 'Terjadi kesalahan internal';

  if (error instanceof AppError) {
    status = error.statusCode;
    code = error.code;
    type = error.type;
    message = error.message;
  } else if (error instanceof BankaiError) {
    const sanitized = sanitizeUpstreamStatus(error.status);
    status = sanitized.status;
    code = sanitized.code;
    type = sanitized.type;
    message = sanitized.message;
  } else if (isTimeoutError(error)) {
    status = upstreamTimeout.status;
    code = upstreamTimeout.code;
    type = upstreamTimeout.type;
    message = upstreamTimeout.message;
  } else if (error instanceof ZodError) {
    status = 400;
    code = 'validation_failed';
    type = 'invalid_request_error';
    message = 'Input tidak valid';
  } else if (isUniqueViolation(error)) {
    status = 409;
    code = 'duplicate_request';
    type = 'invalid_request_error';
    message = 'Request duplikat';
  } else {
    const fastifyError = error as FastifyError;
    if (fastifyError.validation) {
      status = 400;
      code = 'validation_failed';
      type = 'invalid_request_error';
      message = 'Input tidak valid';
    } else if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      status = fastifyError.statusCode;
      code = 'request_failed';
      type = 'invalid_request_error';
      message = fastifyError.message;
    } else if (fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      status = 413;
      code = 'payload_too_large';
      type = 'invalid_request_error';
      message = 'Body request terlalu besar';
    }
  }

  request.log.error(
    {
      err: error,
      requestId: request.id,
      statusCode: status,
      upstreamStatus: error instanceof BankaiError ? error.status : undefined,
      upstreamCode: error instanceof BankaiError ? error.code : undefined,
    },
    'request failed',
  );

  reply.status(status).send({
    error: {
      message,
      type,
      code,
      request_id: request.id,
    },
  });
}
