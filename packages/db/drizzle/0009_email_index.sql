-- Normalisasi data lama agar index biasa pada email tetap unik.
-- Aman dijalankan selagi index lower(email) lama masih ada.
UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");--> statement-breakpoint
DROP INDEX IF EXISTS "users_email_lower_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");
