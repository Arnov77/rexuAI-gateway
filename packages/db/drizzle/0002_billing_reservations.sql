ALTER TYPE "public"."billing_status" ADD VALUE 'reserved' BEFORE 'skipped';--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "reserved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "reservation_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "usage_logs_reservation_expiry_idx" ON "usage_logs" USING btree ("status","reservation_expires_at");--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_reserved_non_negative" CHECK ("usage_logs"."reserved_tokens" >= 0);