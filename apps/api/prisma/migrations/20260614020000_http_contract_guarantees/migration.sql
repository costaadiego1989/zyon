CREATE TABLE "http_idempotency_records" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'processing',
    "status_code" INTEGER,
    "response_body" JSONB,
    "response_headers" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "http_idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "http_idempotency_records_merchant_id_idempotency_key_key"
ON "http_idempotency_records"("merchant_id", "idempotency_key");

CREATE INDEX "http_idempotency_records_merchant_id_state_updated_at_idx"
ON "http_idempotency_records"("merchant_id", "state", "updated_at");

CREATE INDEX "http_idempotency_records_expires_at_idx"
ON "http_idempotency_records"("expires_at");

ALTER TABLE "http_idempotency_records"
ADD CONSTRAINT "http_idempotency_records_merchant_id_fkey"
FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
