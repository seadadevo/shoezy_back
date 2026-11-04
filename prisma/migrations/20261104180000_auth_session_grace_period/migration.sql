-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "previous_refresh_token_hash" VARCHAR(255);
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "rotated_at" TIMESTAMPTZ;

