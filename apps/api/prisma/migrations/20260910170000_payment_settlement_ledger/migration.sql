-- Immutable payment-settlement ledger. Each state observation is a new
-- settlement snapshot and each allocation is a new entry; no financial fact is
-- updated or deleted in place.

CREATE UNIQUE INDEX "payment_intents_id_merchant_id_key"
ON "payment_intents"("id", "merchant_id");

CREATE TABLE "payment_settlements" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "payment_intent_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "provider_payment_id" TEXT,
  "provider_settlement_id" TEXT,
  "provider_reference" TEXT,
  "planned_gross_cents" INTEGER NOT NULL,
  "planned_platform_fee_cents" INTEGER NOT NULL,
  "planned_merchant_net_cents" INTEGER NOT NULL,
  "planned_provider_fee_cents" INTEGER NOT NULL,
  "confirmed_gross_cents" INTEGER,
  "confirmed_platform_fee_cents" INTEGER,
  "confirmed_merchant_net_cents" INTEGER,
  "confirmed_provider_fee_cents" INTEGER,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_settlements_payment_intent_id_merchant_id_fkey"
    FOREIGN KEY ("payment_intent_id", "merchant_id")
    REFERENCES "payment_intents"("id", "merchant_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "payment_settlements_amounts_nonnegative_check" CHECK (
    "planned_gross_cents" >= 0
    AND "planned_platform_fee_cents" >= 0
    AND "planned_merchant_net_cents" >= 0
    AND "planned_provider_fee_cents" >= 0
    AND ("confirmed_gross_cents" IS NULL OR "confirmed_gross_cents" >= 0)
    AND ("confirmed_platform_fee_cents" IS NULL OR "confirmed_platform_fee_cents" >= 0)
    AND ("confirmed_merchant_net_cents" IS NULL OR "confirmed_merchant_net_cents" >= 0)
    AND ("confirmed_provider_fee_cents" IS NULL OR "confirmed_provider_fee_cents" >= 0)
  ),
  CONSTRAINT "payment_settlements_sequence_positive_check" CHECK ("sequence" > 0)
);

CREATE UNIQUE INDEX "payment_settlements_id_merchant_id_key"
ON "payment_settlements"("id", "merchant_id");

CREATE UNIQUE INDEX "payment_settlements_merchant_id_payment_intent_id_sequence_key"
ON "payment_settlements"("merchant_id", "payment_intent_id", "sequence");

CREATE UNIQUE INDEX "payment_settlements_merchant_id_provider_provider_settlement_id_key"
ON "payment_settlements"("merchant_id", "provider", "provider_settlement_id");

CREATE INDEX "payment_settlements_merchant_id_payment_intent_id_occurred_at_idx"
ON "payment_settlements"("merchant_id", "payment_intent_id", "occurred_at");

CREATE INDEX "payment_settlements_merchant_id_status_occurred_at_idx"
ON "payment_settlements"("merchant_id", "status", "occurred_at");

CREATE INDEX "payment_settlements_provider_status_occurred_at_idx"
ON "payment_settlements"("provider", "status", "occurred_at");

CREATE TABLE "payment_settlement_entries" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "settlement_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "entry_key" TEXT NOT NULL,
  "entry_type" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "recipient_type" TEXT NOT NULL,
  "recipient_reference" TEXT,
  "status" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "planned_amount_cents" INTEGER NOT NULL,
  "confirmed_amount_cents" INTEGER,
  "provider" TEXT NOT NULL,
  "provider_transfer_id" TEXT,
  "provider_reference" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_settlement_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_settlement_entries_settlement_id_merchant_id_fkey"
    FOREIGN KEY ("settlement_id", "merchant_id")
    REFERENCES "payment_settlements"("id", "merchant_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "payment_settlement_entries_amounts_nonnegative_check" CHECK (
    "planned_amount_cents" >= 0
    AND ("confirmed_amount_cents" IS NULL OR "confirmed_amount_cents" >= 0)
  ),
  CONSTRAINT "payment_settlement_entries_sequence_positive_check" CHECK ("sequence" > 0)
);

CREATE UNIQUE INDEX "payment_settlement_entries_merchant_id_settlement_id_sequence_key"
ON "payment_settlement_entries"("merchant_id", "settlement_id", "sequence");

CREATE UNIQUE INDEX "payment_settlement_entries_merchant_id_settlement_id_entry_key_key"
ON "payment_settlement_entries"("merchant_id", "settlement_id", "entry_key");

CREATE UNIQUE INDEX "payment_settlement_entries_merchant_id_provider_provider_transfer_id_key"
ON "payment_settlement_entries"("merchant_id", "provider", "provider_transfer_id");

CREATE INDEX "payment_settlement_entries_merchant_id_status_occurred_at_idx"
ON "payment_settlement_entries"("merchant_id", "status", "occurred_at");

CREATE INDEX "payment_settlement_entries_merchant_id_entry_type_occurred_at_idx"
ON "payment_settlement_entries"("merchant_id", "entry_type", "occurred_at");

CREATE OR REPLACE FUNCTION "prevent_payment_settlement_ledger_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'payment settlement ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_settlements_append_only"
BEFORE UPDATE OR DELETE ON "payment_settlements"
FOR EACH ROW EXECUTE FUNCTION "prevent_payment_settlement_ledger_mutation"();

CREATE TRIGGER "payment_settlement_entries_append_only"
BEFORE UPDATE OR DELETE ON "payment_settlement_entries"
FOR EACH ROW EXECUTE FUNCTION "prevent_payment_settlement_ledger_mutation"();
