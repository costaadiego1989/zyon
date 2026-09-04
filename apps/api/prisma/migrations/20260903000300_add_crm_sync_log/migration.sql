-- CrmSyncLog: per-sync audit trail of contacts/deals pushed to a merchant's CRM.
-- stage = lead (identified, not yet purchased) | customer (completed a sale).
-- Powers the "Leads sincronizados" dashboard panel. Idempotent so `migrate
-- deploy` (prod) creates it and environments provisioned via `db push` are safe.
CREATE TABLE IF NOT EXISTS "crm_sync_log" (
    "id"          TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider"    TEXT NOT NULL,
    "email"       TEXT NOT NULL,
    "stage"       TEXT NOT NULL,
    "status"      TEXT NOT NULL,
    "error_code"  TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_sync_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_sync_log_merchant_id_created_at_idx" ON "crm_sync_log"("merchant_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_sync_log_merchant_id_email_idx" ON "crm_sync_log"("merchant_id", "email");
