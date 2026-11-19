import { BankaiError, bankai } from '../../providers/bankai.js';

const UPSTREAM_HEALTH_MODEL = 'auto';
const UPSTREAM_HEALTH_TIMEOUT_MS = 10_000;

export type UpstreamHealthError = 'timeout' | 'no_usage' | 'no_choices' | 'upstream_error';

export type UpstreamHealthResult = {
  status: 'ok' | 'error' | 'degraded';
  latencyMs: number;
  checkedAt: string;
  model: string;
  details: {
    httpStatus: number | null;
    hasUsage: boolean;
    hasChoices: boolean;
    completionTokens: number | null;
  };
  error: UpstreamHealthError | null;
};

function errorNameOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

function isTimeoutError(error: unknown): boolean {
  const name = errorNameOf(error);
  return name === 'TimeoutError' || name === 'AbortError';
}

function numericOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function checkUpstreamHealth(): Promise<UpstreamHealthResult> {
  const started = Date.now();
  const details: UpstreamHealthResult['details'] = {
    httpStatus: null,
    hasUsage: false,
    hasChoices: false,
    completionTokens: null,
  };

  function result(
    status: UpstreamHealthResult['status'],
    error: UpstreamHealthError | null,
  ): UpstreamHealthResult {
    return {
      status,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      model: UPSTREAM_HEALTH_MODEL,
      details,
      error,
    };
  }

  try {
    const response = await bankai.chat(
      {
        model: UPSTREAM_HEALTH_MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      },
      AbortSignal.timeout(UPSTREAM_HEALTH_TIMEOUT_MS),
    );

    details.httpStatus = response.status;

    const body = response.body as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { completion_tokens?: unknown };
    } | null;

    const choices = body?.choices;
    const hasChoices = Array.isArray(choices) && choices.length > 0;
    const rawContent = hasChoices ? choices[0]?.message?.content : undefined;
    const content = typeof rawContent === 'string' ? rawContent.trim() : '';
    const completionTokens = numericOrNull(body?.usage?.completion_tokens);
    const hasUsage = body?.usage != null && completionTokens != null;

    details.hasChoices = hasChoices;
    details.hasUsage = hasUsage;
    details.completionTokens = completionTokens;

    if (!hasUsage) return result('error', 'no_usage');
    if (!hasChoices || content.length === 0) return result('error', 'no_choices');
    if ((completionTokens ?? 0) < 2) return result('degraded', null);

    return result('ok', null);
  } catch (error) {
    if (isTimeoutError(error)) return result('error', 'timeout');
    details.httpStatus = error instanceof BankaiError ? error.status : null;
    return result('error', 'upstream_error');
  }
}
