export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly type: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { type?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.type = options.type ?? 'invalid_request_error';
    this.details = options.details;
  }
}

export function unauthorized(message = 'Autentikasi diperlukan'): AppError {
  return new AppError(401, 'unauthorized', message, { type: 'authentication_error' });
}

export function forbidden(message = 'Akses ditolak'): AppError {
  return new AppError(403, 'forbidden', message, { type: 'permission_error' });
}

export function notFound(message = 'Resource tidak ditemukan'): AppError {
  return new AppError(404, 'not_found', message);
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, 'validation_failed', message, { details });
}

export function conflict(message: string): AppError {
  return new AppError(409, 'duplicate_request', message, {
    type: 'invalid_request_error',
  });
}
