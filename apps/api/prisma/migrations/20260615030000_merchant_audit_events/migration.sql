CREATE TABLE "merchant_audit_events" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "correlation_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "merchant_audit_events_merchant_id_occurred_at_id_idx"
ON "merchant_audit_events"("merchant_id", "occurred_at", "id");

CREATE INDEX "merchant_audit_events_merchant_id_resource_type_resource_id_idx"
ON "merchant_audit_events"("merchant_id", "resource_type", "resource_id");

ALTER TABLE "merchant_audit_events"
ADD CONSTRAINT "merchant_audit_events_merchant_id_fkey"
FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
