import type { z } from 'zod';
import { badRequest } from './errors.js';

export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest('Input tidak valid', result.error.issues);
  }
  return result.data;
}
