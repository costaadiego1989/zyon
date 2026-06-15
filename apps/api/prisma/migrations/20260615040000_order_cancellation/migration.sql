ALTER TABLE "completed_orders"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancellation_reason" TEXT;

CREATE INDEX "completed_orders_merchant_id_status_completed_at_idx"
  ON "completed_orders"("merchant_id", "status", "completed_at");
