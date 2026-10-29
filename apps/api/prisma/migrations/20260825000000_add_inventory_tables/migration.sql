-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "InventoryMovementKind" AS ENUM ('ENTRY', 'EXIT', 'ADJUSTMENT', 'RESERVATION', 'RELEASE', 'TRANSFER_IN', 'TRANSFER_OUT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable: inventory_locations
CREATE TABLE IF NOT EXISTS "inventory_locations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'warehouse',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: inventory_items
CREATE TABLE IF NOT EXISTS "inventory_items" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "variant_name" TEXT,
    "location_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "reorder_point" INTEGER,
    "low_stock_threshold" INTEGER,
    "avg_cost_cents" INTEGER,
    "last_counted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: inventory_movements
CREATE TABLE IF NOT EXISTS "inventory_movements" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" "InventoryMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "external_ref" TEXT,
    "source" TEXT NOT NULL DEFAULT 'native',
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable: inventory_alerts
CREATE TABLE IF NOT EXISTS "inventory_alerts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    CONSTRAINT "inventory_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: erp_connections
CREATE TABLE IF NOT EXISTS "erp_connections" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "direction_mode" TEXT NOT NULL DEFAULT 'erp_source_of_truth',
    "access_token_cipher" TEXT,
    "refresh_token_cipher" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "erp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable: crm_connections
CREATE TABLE IF NOT EXISTS "crm_connections" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "access_token_cipher" TEXT,
    "refresh_token_cipher" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_connections_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_locations_merchant_id_name_key" ON "inventory_locations"("merchant_id", "name");
CREATE INDEX IF NOT EXISTS "inventory_locations_merchant_id_is_active_idx" ON "inventory_locations"("merchant_id", "is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_items_merchant_id_sku_location_id_key" ON "inventory_items"("merchant_id", "sku", "location_id");
CREATE INDEX IF NOT EXISTS "inventory_items_merchant_id_location_id_idx" ON "inventory_items"("merchant_id", "location_id");
CREATE INDEX IF NOT EXISTS "inventory_items_merchant_id_sku_idx" ON "inventory_items"("merchant_id", "sku");

CREATE INDEX IF NOT EXISTS "inventory_movements_merchant_id_item_id_created_at_idx" ON "inventory_movements"("merchant_id", "item_id", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_movements_merchant_id_kind_created_at_idx" ON "inventory_movements"("merchant_id", "kind", "created_at");

CREATE INDEX IF NOT EXISTS "inventory_alerts_merchant_id_acknowledged_created_at_idx" ON "inventory_alerts"("merchant_id", "acknowledged", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "erp_connections_merchant_id_provider_key" ON "erp_connections"("merchant_id", "provider");
CREATE INDEX IF NOT EXISTS "erp_connections_merchant_id_status_idx" ON "erp_connections"("merchant_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "crm_connections_merchant_id_provider_key" ON "crm_connections"("merchant_id", "provider");
CREATE INDEX IF NOT EXISTS "crm_connections_merchant_id_status_idx" ON "crm_connections"("merchant_id", "status");

-- FKs
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_connections" ADD CONSTRAINT "erp_connections_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
