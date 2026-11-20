CREATE TABLE "fiscal_olist_oauth_sessions" (
  "state_hash" CHAR(64) NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "environment" "FiscalEnvironment" NOT NULL,
  "credential_cipher" TEXT,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "claimed_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "result_connection_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_olist_oauth_sessions_pkey" PRIMARY KEY ("state_hash"),
  CONSTRAINT "fiscal_olist_oauth_sessions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "fiscal_olist_oauth_scope_expiry" ON "fiscal_olist_oauth_sessions"("merchant_id", "environment", "expires_at");

ALTER TABLE "fiscal_connections"
  ADD COLUMN IF NOT EXISTS "olist_notification_id" CHAR(64),
  ADD COLUMN IF NOT EXISTS "olist_notification_at" TIMESTAMPTZ(3);
