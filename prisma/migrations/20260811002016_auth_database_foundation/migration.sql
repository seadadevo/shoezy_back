-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "rotation_counter" INTEGER NOT NULL DEFAULT 0,
    "user_agent" TEXT,
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoke_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email_snapshot" VARCHAR(320) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_created_at_idx" ON "password_reset_tokens"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "email_verification_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_created_at_idx" ON "email_verification_tokens"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_provider_id_key" ON "users"("provider", "provider_id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Custom Check Constraints for Auth Tables
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_rotation_counter_nonnegative_chk" CHECK ("rotation_counter" >= 0);
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_expires_at_valid_chk" CHECK ("expires_at" > "created_at");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_revoked_at_valid_chk" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_last_used_at_valid_chk" CHECK ("last_used_at" IS NULL OR "last_used_at" >= "created_at");

ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_expires_at_valid_chk" CHECK ("expires_at" > "created_at");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_used_at_valid_chk" CHECK ("used_at" IS NULL OR "used_at" >= "created_at");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_revoked_at_valid_chk" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_expires_at_valid_chk" CHECK ("expires_at" > "created_at");
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_used_at_valid_chk" CHECK ("used_at" IS NULL OR "used_at" >= "created_at");
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_revoked_at_valid_chk" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");
