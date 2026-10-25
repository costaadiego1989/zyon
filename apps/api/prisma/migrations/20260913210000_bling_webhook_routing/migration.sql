CREATE TABLE "erp_webhook_routes" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_account_id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "erp_webhook_routes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "erp_webhook_routes_provider_external_account_id_key"
  ON "erp_webhook_routes"("provider", "external_account_id");
CREATE UNIQUE INDEX "erp_webhook_routes_connection_id_key"
  ON "erp_webhook_routes"("connection_id");
CREATE INDEX "erp_webhook_routes_merchant_id_idx"
  ON "erp_webhook_routes"("merchant_id");

ALTER TABLE "erp_webhook_routes"
  ADD CONSTRAINT "erp_webhook_routes_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
