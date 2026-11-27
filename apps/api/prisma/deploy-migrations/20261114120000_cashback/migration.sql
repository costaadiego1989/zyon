-- Cashback is opt-in; no rules or credits are seeded.
CREATE TABLE "cashback_programs" (
  "merchant_id" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled','active','paused','ended')),
  "draft" JSONB,
  "published" JSONB,
  "version" INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE "cashback_rule_versions" (
  "merchant_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "rules" JSONB NOT NULL,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY("merchant_id","version"),
  FOREIGN KEY("merchant_id") REFERENCES "cashback_programs"("merchant_id") ON DELETE RESTRICT
);
CREATE TABLE "cashback_wallets" (
  "merchant_id" TEXT NOT NULL,
  "buyer_id" TEXT NOT NULL,
  "balance" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY("merchant_id","buyer_id")
);
CREATE TABLE "cashback_grants" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "buyer_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  UNIQUE("merchant_id","order_id"),
  UNIQUE("id","merchant_id","buyer_id"),
  FOREIGN KEY("merchant_id","buyer_id") REFERENCES "cashback_wallets"("merchant_id","buyer_id") ON DELETE RESTRICT
);
CREATE TABLE "cashback_reservations" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "buyer_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK(state IN ('reserved','payment_pending','consumed','released')),
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  FOREIGN KEY("merchant_id","buyer_id") REFERENCES "cashback_wallets"("merchant_id","buyer_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "cashback_one_live_reservation" ON "cashback_reservations"("merchant_id","session_id") WHERE state IN ('reserved','payment_pending');
CREATE TABLE "cashback_ledger_entries" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "buyer_id" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK(type IN ('grant','release','reserve','unreserve','redeem','expire','reverse','restore','adjustment','loss')),
  "amount_cents" BIGINT NOT NULL,
  "order_id" TEXT,
  "session_id" TEXT,
  "reason" TEXT NOT NULL,
  "actor_id" TEXT,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  FOREIGN KEY("merchant_id","buyer_id") REFERENCES "cashback_wallets"("merchant_id","buyer_id") ON DELETE RESTRICT
);
CREATE INDEX "cashback_ledger_tenant_time" ON "cashback_ledger_entries"("merchant_id","occurred_at" DESC,"id");
CREATE INDEX "cashback_ledger_buyer_time" ON "cashback_ledger_entries"("merchant_id","buyer_id","occurred_at" DESC);
CREATE TABLE "cashback_event_receipts" (
  "merchant_id" TEXT NOT NULL,
  "command_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "result" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY("merchant_id","command_key")
);
CREATE TABLE "cashback_budget_periods" (
  "merchant_id" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "committed_cents" BIGINT NOT NULL DEFAULT 0 CHECK(committed_cents>=0),
  "issued_cents" BIGINT NOT NULL DEFAULT 0 CHECK(issued_cents>=0),
  PRIMARY KEY("merchant_id","period")
);
CREATE TABLE "cashback_earning_quotes" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "buyer_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "payment_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK(state IN ('prepared','bound','confirmed','failed')),
  "payment_intent_id" TEXT,
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("merchant_id","session_id","payment_key"),
  UNIQUE("merchant_id","payment_intent_id")
);
CREATE UNIQUE INDEX "cashback_one_live_payment_quote" ON "cashback_earning_quotes"("merchant_id","session_id") WHERE state IN ('prepared','bound');
CREATE INDEX "cashback_quote_buyer_period" ON "cashback_earning_quotes"("merchant_id","buyer_id","created_at");
CREATE TABLE "cashback_buyer_aliases" (
  "merchant_id" TEXT NOT NULL,
  "alias_buyer_id" TEXT NOT NULL,
  "canonical_buyer_id" TEXT NOT NULL,
  "verification_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY("merchant_id","alias_buyer_id"),
  CHECK("alias_buyer_id"<>"canonical_buyer_id"),
  FOREIGN KEY("merchant_id","canonical_buyer_id") REFERENCES "cashback_wallets"("merchant_id","buyer_id") ON DELETE RESTRICT
);
CREATE INDEX "cashback_alias_canonical" ON "cashback_buyer_aliases"("merchant_id","canonical_buyer_id");
CREATE TABLE "cashback_refund_operations" (
  "merchant_id" TEXT NOT NULL,
  "command_key" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "amount_cents" BIGINT NOT NULL CHECK(amount_cents>=0),
  "state" TEXT NOT NULL CHECK(state IN ('submitted','completed','failed')),
  "provider_refund_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY("merchant_id","command_key")
);
CREATE UNIQUE INDEX "cashback_one_submitted_refund" ON "cashback_refund_operations"("merchant_id","order_id") WHERE state='submitted';
