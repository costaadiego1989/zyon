CREATE TABLE "merchant_installations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "widget_version" TEXT NOT NULL,
    "allowed_origins" TEXT[] NOT NULL,
    "last_health_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_installations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merchant_installations_merchant_id_name_environment_key"
ON "merchant_installations"("merchant_id", "name", "environment");

CREATE INDEX "merchant_installations_merchant_id_environment_status_idx"
ON "merchant_installations"("merchant_id", "environment", "status");

ALTER TABLE "merchant_installations"
ADD CONSTRAINT "merchant_installations_merchant_id_fkey"
FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
