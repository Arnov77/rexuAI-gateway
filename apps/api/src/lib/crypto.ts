import { createHash, createHmac, randomBytes } from 'node:crypto';
import { API_KEY_PREFIX } from '@rexu/shared';
import { env } from '../config/env.js';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
}

export function hashSessionToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}

export function hashApiKey(key: string): string {
  return createHmac('sha256', env.API_KEY_PEPPER).update(key).digest('hex');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + 8);
}

export function apiKeyLastFour(key: string): string {
  return key.slice(-4);
}
