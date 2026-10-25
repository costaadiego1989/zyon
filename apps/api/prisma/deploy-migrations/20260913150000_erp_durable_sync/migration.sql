ALTER TABLE "erp_connections"
  ALTER COLUMN "direction_mode" SET DEFAULT 'bidirectional';

-- The merchant explicitly authorized this release to enable bidirectional
-- stock synchronization for legacy ERP connections.
UPDATE "erp_connections"
  SET "direction_mode" = 'bidirectional'
  WHERE "direction_mode" = 'erp_source_of_truth';

CREATE TABLE "erp_sync_jobs" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "dedupe_key" TEXT NOT NULL,
  "payload" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "locked_until" TIMESTAMP(3),
  "last_error_code" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "erp_sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "erp_sync_jobs_dedupe_key_key" ON "erp_sync_jobs"("dedupe_key");
CREATE INDEX "erp_sync_jobs_status_next_attempt_at_created_at_idx" ON "erp_sync_jobs"("status", "next_attempt_at", "created_at");
CREATE INDEX "erp_sync_jobs_status_locked_until_idx" ON "erp_sync_jobs"("status", "locked_until");
CREATE INDEX "erp_sync_jobs_merchant_id_connection_id_created_at_idx" ON "erp_sync_jobs"("merchant_id", "connection_id", "created_at");
ALTER TABLE "erp_sync_jobs" ADD CONSTRAINT "erp_sync_jobs_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "erp_product_mappings" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "variant_id" TEXT,
  "sku" TEXT NOT NULL,
  "external_product_id" TEXT NOT NULL,
  "external_location_id" TEXT NOT NULL DEFAULT '0',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "erp_product_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "erp_product_mappings_connection_id_external_product_id_external_location_id_key"
  ON "erp_product_mappings"("connection_id", "external_product_id", "external_location_id");
CREATE UNIQUE INDEX "erp_product_mappings_connection_id_sku_external_location_id_key"
  ON "erp_product_mappings"("connection_id", "sku", "external_location_id");
CREATE INDEX "erp_product_mappings_merchant_id_sku_idx" ON "erp_product_mappings"("merchant_id", "sku");
ALTER TABLE "erp_product_mappings" ADD CONSTRAINT "erp_product_mappings_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
