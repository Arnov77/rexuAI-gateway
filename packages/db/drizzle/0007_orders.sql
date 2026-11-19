ALTER TABLE "orders" DROP CONSTRAINT "orders_package_id_token_packages_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "package_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "orders" SET "expires_at" = "created_at" + interval '30 minutes' WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "midtrans_transaction_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qr_string" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qr_image_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_type" text DEFAULT 'qris' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "webhook_payload" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_package_id_token_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."token_packages"("id") ON DELETE set null ON UPDATE no action;