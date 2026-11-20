/**
 * Verified BankAI catalog multipliers in basis points (10000 = 1x).
 *
 * BankAI's `GET /v1/models` response does not expose a multiplier field, so a
 * fresh catalog sync cannot discover these values. Keep the verified table here
 * and seed new model rows from it; unknown model IDs fall back to 1x and remain
 * disabled until an admin sets a verified multiplier.
 *
 * Source: migration 0003_bankai_multiplier.sql and
 * docs/bankai-multiplier-report.md.
 */
export const BANKAI_MULTIPLIER_BP: Readonly<Record<string, number>> = {
  auto: 10_000,
  'deepseek-v4-flash': 20_000,
  'deepseek-v4-flash-0731': 20_000,
  'deepseek-v4-flash-vision-exp': 25_000,
  'deepseek-v4-mod': 30_000,
  'deepseek-v4-uncensored': 30_000,
  'deepseek-v4-pro': 11_500,
  'deepseek-v4.1-flash': 25_600,
  'deepseek-v4.1-flash-1017': 30_000,
  'deepseek-v4.1-flash-1017-mod': 35_000,
  'deepseek-v4.1-flash-1017-uncensored': 35_000,
  'deepseek-v4.1-flash-mod': 32_000,
  'deepseek-v4.1-flash-uncensored': 32_000,
  'gemini-4-argon': 600_000,
  'glm-5.2': 12_500,
  'glm-5.2-mod': 30_000,
  'glm-5.2-uncensored': 30_000,
  'glm-5.3': 20_000,
  'glm-5.3-flash': 20_000,
  'glm-5.3-flash-mod': 35_000,
  'glm-5.3-flash-uncensored': 35_000,
  'glm-5.3-mod': 32_000,
  'glm-5.3-uncensored': 32_000,
  'gpt-6-astra': 420_000,
  'gpt-6-luna': 80_000,
  'kimi-k2.7-code': 10_000,
  'kimi-k2.7-code-highspeed': 15_000,
  'kimi-k2.8': 20_000,
  'mimo-v2.5-pro': 14_000,
  'mimo-v2.6-flash': 20_000,
  'mimo-v2.6-pro': 20_000,
};

export const DEFAULT_BANKAI_MULTIPLIER_BP = 10_000;

export function bankaiMultiplierBpFor(modelId: string): number {
  return BANKAI_MULTIPLIER_BP[modelId] ?? DEFAULT_BANKAI_MULTIPLIER_BP;
}

export function hasVerifiedBankaiMultiplier(modelId: string): boolean {
  return modelId in BANKAI_MULTIPLIER_BP;
}
