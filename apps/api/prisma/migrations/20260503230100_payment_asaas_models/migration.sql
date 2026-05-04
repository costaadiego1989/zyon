-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "approved_amount_cents" INTEGER,
    "accepted_offer_id" TEXT,
    "buyer_facing" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_provider_events" (
    "id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_merchant_id_session_id_idempotency_key_key" ON "payment_intents"("merchant_id", "session_id", "idempotency_key");

-- CreateIndex (nullable provider_payment_id: duplicate NULL pairs allowed under PostgreSQL unique semantics)
CREATE UNIQUE INDEX "payment_intents_merchant_id_provider_payment_id_key" ON "payment_intents"("merchant_id", "provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_intents_merchant_id_session_id_idx" ON "payment_intents"("merchant_id", "session_id");
