-- CreateTable
CREATE TABLE "merchant_negotiation_policies" (
    "merchant_id" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_negotiation_policies_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "buyer_agent_negotiation_preferences" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "preferences" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_agent_negotiation_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_sessions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT,
    "cart_fingerprint" TEXT NOT NULL,
    "result_json" JSONB NOT NULL,
    "estimated_ai_calls" INTEGER NOT NULL,
    "estimated_ai_cost_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_cost_ledger_entries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "negotiation_session_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_cost_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyer_agent_negotiation_preferences_merchant_id_global_user_id_key" ON "buyer_agent_negotiation_preferences"("merchant_id", "global_user_id");

-- CreateIndex
CREATE INDEX "buyer_agent_negotiation_preferences_merchant_id_idx" ON "buyer_agent_negotiation_preferences"("merchant_id");

-- CreateIndex
CREATE INDEX "negotiation_sessions_merchant_id_created_at_idx" ON "negotiation_sessions"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "negotiation_cost_ledger_entries_merchant_id_negotiation_session_id_idx" ON "negotiation_cost_ledger_entries"("merchant_id", "negotiation_session_id");

-- AddForeignKey
ALTER TABLE "negotiation_cost_ledger_entries" ADD CONSTRAINT "negotiation_cost_ledger_entries_negotiation_session_id_fkey" FOREIGN KEY ("negotiation_session_id") REFERENCES "negotiation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
