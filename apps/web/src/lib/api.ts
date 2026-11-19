export type ApiErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
    request_id?: string;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(
    status: number,
    message: string,
    code = 'request_failed',
    requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const payload = body as ApiErrorPayload | null;
    throw new ApiError(
      response.status,
      payload?.error?.message ?? `Request gagal (${response.status})`,
      payload?.error?.code ?? 'request_failed',
      payload?.error?.request_id ?? null,
    );
  }

  return body as T;
}

export async function apiWithResponse<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; response: Response }> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const payload = body as ApiErrorPayload | null;
    throw new ApiError(
      response.status,
      payload?.error?.message ?? `Request gagal (${response.status})`,
      payload?.error?.code ?? 'request_failed',
      payload?.error?.request_id ?? null,
    );
  }

  return { data: body as T, response };
}
