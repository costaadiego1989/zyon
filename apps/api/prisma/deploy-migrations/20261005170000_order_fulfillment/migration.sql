ALTER TABLE "completed_orders" ADD COLUMN "fulfillment_json" JSONB,
  ADD COLUMN "fulfillment_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "fulfilled_at" TIMESTAMP(3);
CREATE TABLE "order_fulfillment_actions" (
  "id" TEXT NOT NULL PRIMARY KEY, "merchant_id" TEXT NOT NULL, "order_id" TEXT NOT NULL,
  "command_id" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "unit_id" TEXT NOT NULL,
  "action" TEXT NOT NULL, "actor_id" TEXT NOT NULL, "origin" TEXT NOT NULL,
  "from_status" TEXT NOT NULL, "to_status" TEXT NOT NULL, "quantity" INTEGER NOT NULL,
  "proof" TEXT, "occurred_at" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_fulfillment_actions_order_id_merchant_id_fkey" FOREIGN KEY ("order_id", "merchant_id") REFERENCES "completed_orders"("id", "merchant_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "order_fulfillment_actions_merchant_id_command_id_key" ON "order_fulfillment_actions"("merchant_id", "command_id");
CREATE INDEX "order_fulfillment_actions_merchant_id_order_id_created_at_idx" ON "order_fulfillment_actions"("merchant_id", "order_id", "created_at");
CREATE TABLE "service_reservations" (
  "id" TEXT NOT NULL PRIMARY KEY, "merchant_id" TEXT NOT NULL, "order_id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL, "resource_id" TEXT NOT NULL, "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL DEFAULT 'reserved',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_reservations_order_id_merchant_id_fkey" FOREIGN KEY ("order_id", "merchant_id") REFERENCES "completed_orders"("id", "merchant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_reservations_interval_check" CHECK ("ends_at" > "starts_at")
);
CREATE UNIQUE INDEX "service_reservations_order_id_unit_id_key" ON "service_reservations"("order_id", "unit_id");
CREATE INDEX "service_reservations_merchant_id_resource_id_status_starts_at_idx" ON "service_reservations"("merchant_id", "resource_id", "status", "starts_at");
