CREATE TABLE "meta_ads_agent_stores" (
  "merchant_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_ads_agent_stores_pkey" PRIMARY KEY ("merchant_id"),
  CONSTRAINT "meta_ads_agent_stores_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "meta_ads_agent_store_tenant" CHECK (jsonb_typeof("state") = 'object' AND "state"->>'merchantId' IS NOT NULL AND "state"->>'merchantId' = "merchant_id")
);

CREATE TABLE "meta_ads_agent_records" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_ads_agent_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meta_ads_agent_records_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "meta_ads_agent_records_merchant_id_key_key" ON "meta_ads_agent_records"("merchant_id", "key");
CREATE INDEX "meta_ads_agent_records_merchant_id_kind_created_at_idx" ON "meta_ads_agent_records"("merchant_id", "kind", "created_at");
