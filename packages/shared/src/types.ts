import type { z } from 'zod';
import type { chatCompletionRequestSchema, publicSettingsSchema } from './schemas.js';

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;
export type PublicSettings = z.infer<typeof publicSettingsSchema>;

export type ProviderModel = {
  id: string;
  object: 'model';
  vision: boolean;
  enabled: boolean;
  available: boolean;
  grade: string;
  created: number;
  modalities: {
    input: string[];
    output: string[];
  };
  owned_by: string;
  gateway?: string;
  daily_quota?: boolean;
};

export type ProviderUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  reasoning_tokens?: number | null;
  cached_tokens?: number | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
};

export type ProviderError = {
  message: string;
  type?: string | null;
  code?: string | null;
  status: number;
};
