ALTER TABLE "usage_logs" RENAME COLUMN "deducted_tokens" TO "tokens_billed";--> statement-breakpoint
ALTER TABLE "usage_logs" RENAME COLUMN "reserved_tokens" TO "tokens_reserved";--> statement-breakpoint
ALTER TABLE "api_keys" RENAME COLUMN "token_limit" TO "credit_limit";--> statement-breakpoint
ALTER TABLE "api_keys" RENAME COLUMN "tokens_used" TO "credits_used";--> statement-breakpoint
ALTER TABLE "wallets" RENAME COLUMN "total_tokens" TO "total_credits";--> statement-breakpoint
ALTER TABLE "wallets" RENAME COLUMN "used_tokens" TO "used_credits";--> statement-breakpoint
ALTER TABLE "wallets" RENAME COLUMN "reserved_tokens" TO "reserved_credits";--> statement-breakpoint
ALTER TABLE "usage_logs" DROP CONSTRAINT "usage_logs_reserved_non_negative";--> statement-breakpoint
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_total_non_negative";--> statement-breakpoint
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_used_non_negative";--> statement-breakpoint
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_reserved_non_negative";--> statement-breakpoint
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_balance_check";--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "credits_deducted" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "credits_reserved" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_tokens_reserved_non_negative" CHECK ("usage_logs"."tokens_reserved" >= 0);--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_credits_deducted_non_negative" CHECK ("usage_logs"."credits_deducted" >= 0);--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_credits_reserved_non_negative" CHECK ("usage_logs"."credits_reserved" >= 0);--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_total_credits_non_negative" CHECK ("wallets"."total_credits" >= 0);--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_used_credits_non_negative" CHECK ("wallets"."used_credits" >= 0);--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_reserved_credits_non_negative" CHECK ("wallets"."reserved_credits" >= 0);--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_check" CHECK ("wallets"."used_credits" + "wallets"."reserved_credits" <= "wallets"."total_credits");