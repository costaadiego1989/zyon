-- CreateTable
CREATE TABLE "crm_connections" (
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

-- CreateIndex
CREATE UNIQUE INDEX "crm_connections_merchant_id_provider_key" ON "crm_connections"("merchant_id", "provider");

-- CreateIndex
CREATE INDEX "crm_connections_merchant_id_status_idx" ON "crm_connections"("merchant_id", "status");

-- AddForeignKey
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
