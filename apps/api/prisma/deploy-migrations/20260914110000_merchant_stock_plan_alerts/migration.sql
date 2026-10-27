ALTER TABLE "inventory_alerts" ADD COLUMN "resolved_at" TIMESTAMP(3);

-- Retain history while consolidating existing unresolved duplicates.
UPDATE "inventory_alerts" SET "resolved_at" = COALESCE("acknowledged_at", "created_at") WHERE "acknowledged" = true;
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY merchant_id, item_id ORDER BY
    CASE severity WHEN 'critical' THEN 0 ELSE 1 END, created_at DESC, id) AS rn
  FROM inventory_alerts WHERE resolved_at IS NULL
)
UPDATE inventory_alerts SET resolved_at = CURRENT_TIMESTAMP, acknowledged = true,
  acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP)
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
CREATE UNIQUE INDEX "inventory_alerts_open_item" ON "inventory_alerts" ("merchant_id", "item_id") WHERE "resolved_at" IS NULL;
CREATE INDEX "inventory_alerts_resolution" ON "inventory_alerts" ("merchant_id", "item_id", "resolved_at");

CREATE TABLE "merchant_plan_notices" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "subscription_key" TEXT NOT NULL,
  "plan_key" TEXT NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "milestone" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "merchant_plan_notices_milestone" ON "merchant_plan_notices" ("merchant_id", "subscription_key", "ends_at", "milestone");
CREATE TABLE "merchant_plan_notice_deliveries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "notice_id" TEXT NOT NULL REFERENCES "merchant_plan_notices" ("id") ON DELETE CASCADE,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_until" TIMESTAMP(3),
  "provider_message_id" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "merchant_plan_notice_deliveries_channel" ON "merchant_plan_notice_deliveries" ("notice_id", "channel");
CREATE INDEX "merchant_plan_notice_deliveries_queue" ON "merchant_plan_notice_deliveries" ("status", "next_attempt_at", "lease_until");
