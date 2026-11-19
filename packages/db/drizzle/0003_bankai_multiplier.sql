ALTER TABLE "usage_logs" ADD COLUMN "bankai_multiplier_bp" integer;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "bankai_multiplier_bp" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_bankai_multiplier_non_negative" CHECK ("models"."bankai_multiplier_bp" >= 0);--> statement-breakpoint
UPDATE "models" SET "bankai_multiplier_bp" = m."bp", "updated_at" = now()
FROM (VALUES
  ('auto', 10000),
  ('deepseek-v4-flash', 20000),
  ('deepseek-v4-flash-0731', 20000),
  ('deepseek-v4-flash-vision-exp', 25000),
  ('deepseek-v4-mod', 30000),
  ('deepseek-v4-uncensored', 30000),
  ('deepseek-v4-pro', 11500),
  ('deepseek-v4.1-flash', 25600),
  ('deepseek-v4.1-flash-1017', 30000),
  ('deepseek-v4.1-flash-1017-mod', 35000),
  ('deepseek-v4.1-flash-1017-uncensored', 35000),
  ('deepseek-v4.1-flash-mod', 32000),
  ('deepseek-v4.1-flash-uncensored', 32000),
  ('gemini-4-argon', 600000),
  ('glm-5.2', 12500),
  ('glm-5.2-mod', 30000),
  ('glm-5.2-uncensored', 30000),
  ('glm-5.3', 20000),
  ('glm-5.3-flash', 20000),
  ('glm-5.3-flash-mod', 35000),
  ('glm-5.3-flash-uncensored', 35000),
  ('glm-5.3-mod', 32000),
  ('glm-5.3-uncensored', 32000),
  ('gpt-6-astra', 420000),
  ('gpt-6-luna', 80000),
  ('kimi-k2.7-code', 10000),
  ('kimi-k2.7-code-highspeed', 15000),
  ('kimi-k2.8', 20000),
  ('mimo-v2.5-pro', 14000),
  ('mimo-v2.6-flash', 20000),
  ('mimo-v2.6-pro', 20000)
) AS m("id", "bp")
WHERE "models"."id" = m."id";--> statement-breakpoint
UPDATE "models" SET "is_enabled" = false, "is_available" = false, "updated_at" = now()
WHERE "id" LIKE '%-FREE' OR "id" IN (
  'MiniMax-M2.7-FREE',
  'DeepSeek-V4-Flash-0731-FREE',
  'GLM-5.3-Flash-FREE',
  'mimo-auto-FREE',
  'big-pickle-FREE',
  'deepseek-v4.1-flash-free-FREE',
  'jev-1.13-free-FREE',
  'mimo-v2.6-flash-free-FREE',
  'nemotron-3.5-lightning-free-FREE'
);
