-- Persist the provider refund identifier so PENDING refunds can be reconciled
-- by a read-only provider request without issuing a second financial POST.
ALTER TABLE "return_refunds"
ADD COLUMN "provider_refund_id" TEXT;

CREATE INDEX "return_refunds_status_created_at_idx"
ON "return_refunds"("status", "created_at");
