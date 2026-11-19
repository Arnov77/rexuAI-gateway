import { ApiError, type ApiErrorPayload } from './api';

export type StreamEvent = {
  content?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

export type StreamHandlers = {
  onEvent: (event: StreamEvent) => void;
  onDone: () => void;
  onError: (error: Error) => void;
};

export async function streamPlayground(
  body: unknown,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetch('/api/user/playground/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = `Request gagal (${response.status})`;
    let code = 'request_failed';
    let requestId: string | null = null;
    try {
      const payload = JSON.parse(text) as ApiErrorPayload;
      message = payload.error?.message ?? message;
      code = payload.error?.code ?? code;
      requestId = payload.error?.request_id ?? null;
    } catch {
      // keep the status message
    }
    throw new ApiError(response.status, message, code, requestId);
  }

  if (!response.body) {
    throw new Error('Stream tidak tersedia');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          handlers.onDone();
          return response;
        }
        try {
          handlers.onEvent(JSON.parse(payload) as StreamEvent);
        } catch {
          // ignore keepalive or malformed frames
        }
      }
    }
    handlers.onDone();
    return response;
  } catch (error) {
    if (signal.aborted) {
      handlers.onDone();
      return response;
    }
    handlers.onError(error instanceof Error ? error : new Error('Stream gagal'));
    throw error;
  }
}
