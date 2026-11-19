export const API_KEY_PREFIX = 'sk-rxu-';
export const MULTIPLIER_BP = 10000;

export const SETTINGS_KEYS = {
  registrationMode: 'registration_mode',
  billingEnabled: 'billing_enabled',
  billingDefaultReserve: 'billing_default_reserve',
  billingMaxReserve: 'billing_max_reserve',
  publicModelMultipliers: 'public_model_multipliers',
  maintenanceMode: 'maintenance_mode',
} as const;

export const ERROR_CODES = {
  invalid_credentials: 'invalid_credentials',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  not_found: 'not_found',
  validation_failed: 'validation_failed',
  insufficient_quota: 'insufficient_quota',
  model_unavailable: 'model_unavailable',
  duplicate_request: 'duplicate_request',
  rate_limited: 'rate_limited',
  upstream_error: 'upstream_error',
  upstream_timeout: 'upstream_timeout',
  internal_error: 'internal_error',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
