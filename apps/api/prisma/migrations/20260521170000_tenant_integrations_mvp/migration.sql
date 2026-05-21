CREATE TABLE "merchant_api_keys" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "key_prefix" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "merchant_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "merchant_webhook_endpoints" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "signing_secret" TEXT NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "merchant_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "merchant_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "endpoint_id" TEXT NOT NULL,
  "endpoint_url" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "envelope" JSONB NOT NULL,
  "signing_secret" TEXT NOT NULL,
  "next_attempt_at" TIMESTAMP(3),
  "response_status" INTEGER,
  "response_body" TEXT,
  "error" TEXT,
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "merchant_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shipments" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "external_order_id" TEXT NOT NULL,
  "carrier" TEXT NOT NULL,
  "tracking_code" TEXT NOT NULL,
  "tracking_url" TEXT,
  "status" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "estimated_eta" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),

  CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tracking_events" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "shipment_id" TEXT NOT NULL,
  "tracking_code" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "location" TEXT,
  "carrier_raw" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merchant_api_keys_key_hash_key" ON "merchant_api_keys"("key_hash");
CREATE INDEX "merchant_api_keys_merchant_id_revoked_at_idx" ON "merchant_api_keys"("merchant_id", "revoked_at");

CREATE INDEX "merchant_webhook_endpoints_merchant_id_enabled_idx" ON "merchant_webhook_endpoints"("merchant_id", "enabled");

CREATE UNIQUE INDEX "merchant_webhook_deliveries_endpoint_id_event_id_key" ON "merchant_webhook_deliveries"("endpoint_id", "event_id");
CREATE INDEX "merchant_webhook_deliveries_merchant_id_status_next_attempt_at_idx" ON "merchant_webhook_deliveries"("merchant_id", "status", "next_attempt_at");
CREATE INDEX "merchant_webhook_deliveries_merchant_id_created_at_idx" ON "merchant_webhook_deliveries"("merchant_id", "created_at");

CREATE UNIQUE INDEX "shipments_merchant_id_external_order_id_key" ON "shipments"("merchant_id", "external_order_id");
CREATE UNIQUE INDEX "shipments_merchant_id_tracking_code_key" ON "shipments"("merchant_id", "tracking_code");
CREATE INDEX "shipments_merchant_id_status_updated_at_idx" ON "shipments"("merchant_id", "status", "updated_at");

CREATE INDEX "tracking_events_merchant_id_tracking_code_occurred_at_idx" ON "tracking_events"("merchant_id", "tracking_code", "occurred_at");
CREATE INDEX "tracking_events_shipment_id_occurred_at_idx" ON "tracking_events"("shipment_id", "occurred_at");

ALTER TABLE "merchant_api_keys" ADD CONSTRAINT "merchant_api_keys_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merchant_webhook_endpoints" ADD CONSTRAINT "merchant_webhook_endpoints_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merchant_webhook_deliveries" ADD CONSTRAINT "merchant_webhook_deliveries_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merchant_webhook_deliveries" ADD CONSTRAINT "merchant_webhook_deliveries_endpoint_id_fkey"
  FOREIGN KEY ("endpoint_id") REFERENCES "merchant_webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
