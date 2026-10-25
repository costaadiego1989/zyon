-- This release path is used by Railway. Keep the reconciliation metadata
-- idempotent because some production databases were initialized from a schema
-- snapshot before this versioned migration existed.
ALTER TABLE "return_refunds"
  ADD COLUMN IF NOT EXISTS "provider_refund_id" TEXT;

CREATE INDEX IF NOT EXISTS "return_refunds_status_created_at_idx"
  ON "return_refunds"("status", "created_at");
