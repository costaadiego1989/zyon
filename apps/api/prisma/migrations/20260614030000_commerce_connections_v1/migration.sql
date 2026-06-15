ALTER TABLE "merchant_commerce_connections"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "last_tested_at" TIMESTAMP(3),
ADD COLUMN "last_synced_at" TIMESTAMP(3),
ADD COLUMN "last_error_code" TEXT;

CREATE INDEX "merchant_commerce_connections_provider_status_idx"
ON "merchant_commerce_connections"("provider", "status");
