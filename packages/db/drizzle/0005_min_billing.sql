ALTER TABLE "usage_logs" ADD COLUMN "effective_min_block" integer;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "min_block_override" integer;--> statement-breakpoint
-- Override minimum block untuk model premium yang base-nya berbeda dari formula.
-- gpt-6-astra belum dikalibrasi; nilai konservatif mengikuti gpt-6-luna.
UPDATE "models" SET "min_block_override" = 45680 WHERE "id" = 'gpt-6-luna';--> statement-breakpoint
UPDATE "models" SET "min_block_override" = 45680 WHERE "id" = 'gpt-6-astra';
