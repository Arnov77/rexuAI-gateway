import { z } from 'zod';
import { API_KEY_PREFIX, MULTIPLIER_BP, SETTINGS_KEYS } from './constants.js';

export const idSchema = z.string().uuid();
export const modelIdSchema = z.string().min(1).max(128);
export const emailSchema = z.string().email().max(254);
export const passwordSchema = z.string().min(8).max(200);

export const multiplierBpSchema = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647)
  .describe('Multiplier in basis points. 10000 = 1x.');

export function multiplierFromDecimal(value: number): number {
  return Math.round(value * MULTIPLIER_BP);
}

export function deductedCredits(
  rawTokens: number,
  bankaiMultiplierBp: number,
  rexuMarkupBp: number = MULTIPLIER_BP,
): number {
  if (!Number.isSafeInteger(rawTokens) || rawTokens < 0) {
    throw new RangeError('rawTokens must be a safe non-negative integer');
  }
  if (!Number.isSafeInteger(bankaiMultiplierBp) || bankaiMultiplierBp < 0) {
    throw new RangeError('bankaiMultiplierBp must be a safe non-negative integer');
  }
  if (!Number.isSafeInteger(rexuMarkupBp) || rexuMarkupBp <= 0) {
    throw new RangeError('rexuMarkupBp must be a safe positive integer');
  }
  const bp = BigInt(MULTIPLIER_BP);
  const creditRate = 1_000n;
  const tokensBankAI =
    (BigInt(rawTokens) * BigInt(bankaiMultiplierBp) * BigInt(rexuMarkupBp) + bp * bp - 1n) /
    (bp * bp);
  return Number((tokensBankAI + creditRate - 1n) / creditRate);
}

export const chatMessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export const chatTextContentSchema = z.string().max(200_000);
export const chatPartContentSchema = z.array(z.record(z.string(), z.unknown())).min(1);
export const chatMessageSchema = z.object({
  role: chatMessageRoleSchema,
  content: z.union([chatTextContentSchema, chatPartContentSchema]),
});

export const chatCompletionRequestSchema = z
  .object({
    model: modelIdSchema,
    messages: z.array(chatMessageSchema).min(1).max(256),
    stream: z.boolean().optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    temperature: z.number().optional(),
  })
  .loose();

export const registrationModeSchema = z.enum(['closed', 'public']);
export const billingEnabledSchema = z.boolean();
export const reserveSchema = z.number().int().min(0).max(2_147_483_647);

export const publicSettingsSchema = z.object({
  registrationMode: registrationModeSchema,
  publicModelMultipliers: z.boolean(),
  maintenanceMode: z.boolean(),
});

export { API_KEY_PREFIX, MULTIPLIER_BP, SETTINGS_KEYS };
