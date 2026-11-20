-- CreateEnum
CREATE TYPE "FiscalProvider" AS ENUM ('bling', 'omie', 'tiny', 'focus');

-- CreateEnum
CREATE TYPE "FiscalEnvironment" AS ENUM ('homologation', 'production');

-- CreateTable
CREATE TABLE "fiscal_connections" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" "FiscalProvider" NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "issuer_tax_id" TEXT NOT NULL,
    "credential_cipher" TEXT,
    "erp_connection_id" TEXT,
    "readiness" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" TIMESTAMPTZ(3),
    "disconnected_at" TIMESTAMPTZ(3),
    "stock_owner" TEXT NOT NULL DEFAULT 'zyon',
    "email_owner" TEXT NOT NULL DEFAULT 'zyon',
    "whatsapp_owner" TEXT NOT NULL DEFAULT 'zyon',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fiscal_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_profile_versions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" "FiscalProvider" NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "operation" TEXT NOT NULL DEFAULT 'sale',
    "version" INTEGER NOT NULL,
    "issuer_regime" TEXT NOT NULL,
    "item_rules" JSONB NOT NULL,
    "recipient_requirements" JSONB NOT NULL,
    "source_contract_version" TEXT NOT NULL,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_sale_snapshots" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "order_merchant_id" TEXT NOT NULL,
    "completed_order_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "buyer_global_user_id" TEXT,
    "recipient" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "subtotal_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "payment_proof_ref" TEXT,
    "content_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_sale_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_intents" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "order_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL DEFAULT 'sale',
    "connection_id" TEXT NOT NULL,
    "profile_version_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "stable_reference" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'awaiting_payment',
    "remote_order_id" TEXT,
    "remote_invoice_id" TEXT,
    "write_stage" TEXT,
    "write_started_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMPTZ(3),
    "lease_token" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fiscal_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_documents" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "intent_id" TEXT NOT NULL,
    "issuer_tax_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'processing',
    "provider_status" TEXT,
    "number" TEXT,
    "series" TEXT,
    "access_key" TEXT,
    "authorization_protocol" TEXT,
    "authorized_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_protocol" TEXT,
    "document_state" TEXT NOT NULL DEFAULT 'document_pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_artifacts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "document_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "private_object_key" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "retrieved_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fiscal_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_events" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "intent_id" TEXT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "previous_state" TEXT,
    "next_state" TEXT,
    "safe_reason_code" TEXT,
    "provider_evidence_ref" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_deliveries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "document_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "responsible_sender" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMPTZ(3),
    "lease_token" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "safe_reason_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fiscal_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_cancellation_reviews" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "document_id" TEXT NOT NULL,
    "trigger_id" TEXT NOT NULL,
    "trigger_kind" TEXT NOT NULL,
    "review_state" TEXT NOT NULL DEFAULT 'needs_confirmation',
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "justification" TEXT,
    "provider_request_ref" TEXT,
    "safe_reason_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fiscal_cancellation_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_connections_merchant_environment" ON "fiscal_connections"("merchant_id", "environment", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_connections_scope" ON "fiscal_connections"("id", "merchant_id", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_profiles_scope" ON "fiscal_profile_versions"("id", "merchant_id", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_profiles_version" ON "fiscal_profile_versions"("merchant_id", "environment", "provider", "operation", "version");

-- CreateIndex
CREATE INDEX "fiscal_snapshots_commercial_order" ON "fiscal_sale_snapshots"("order_merchant_id", "completed_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_snapshots_scope" ON "fiscal_sale_snapshots"("id", "merchant_id", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_snapshots_sale" ON "fiscal_sale_snapshots"("merchant_id", "order_id", "environment");

-- CreateIndex
CREATE INDEX "fiscal_intents_queue" ON "fiscal_intents"("state", "next_attempt_at", "lease_until");

-- CreateIndex
CREATE INDEX "fiscal_intents_merchant_created" ON "fiscal_intents"("merchant_id", "environment", "created_at", "id");

-- CreateIndex
CREATE INDEX "fiscal_intents_merchant_state" ON "fiscal_intents"("merchant_id", "state", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_intents_scope" ON "fiscal_intents"("id", "merchant_id", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_intents_sale_operation" ON "fiscal_intents"("merchant_id", "order_id", "environment", "operation");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_intents_remote_reference" ON "fiscal_intents"("connection_id", "stable_reference");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_intent_id_key" ON "fiscal_documents"("intent_id");

-- CreateIndex
CREATE INDEX "fiscal_documents_merchant_state" ON "fiscal_documents"("merchant_id", "environment", "state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_scope" ON "fiscal_documents"("id", "merchant_id", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_intent_scope" ON "fiscal_documents"("intent_id", "merchant_id", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_artifacts_private_object_key_key" ON "fiscal_artifacts"("private_object_key");

-- CreateIndex
CREATE INDEX "fiscal_artifacts_merchant_document" ON "fiscal_artifacts"("merchant_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_artifacts_document_kind" ON "fiscal_artifacts"("document_id", "kind");

-- CreateIndex
CREATE INDEX "fiscal_events_history" ON "fiscal_events"("merchant_id", "intent_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "fiscal_deliveries_queue" ON "fiscal_deliveries"("state", "next_attempt_at", "lease_until");

-- CreateIndex
CREATE INDEX "fiscal_deliveries_provider_message" ON "fiscal_deliveries"("merchant_id", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_deliveries_document_channel" ON "fiscal_deliveries"("document_id", "channel");

-- CreateIndex
CREATE INDEX "fiscal_cancellations_merchant_state" ON "fiscal_cancellation_reviews"("merchant_id", "review_state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_cancellations_trigger" ON "fiscal_cancellation_reviews"("document_id", "trigger_kind", "trigger_id");

-- AddForeignKey
ALTER TABLE "fiscal_connections" ADD CONSTRAINT "fiscal_connections_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_profile_versions" ADD CONSTRAINT "fiscal_profile_versions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_sale_snapshots" ADD CONSTRAINT "fiscal_sale_snapshots_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_sale_snapshots" ADD CONSTRAINT "fiscal_sale_snapshots_completed_order_id_order_merchant_id_fkey" FOREIGN KEY ("completed_order_id", "order_merchant_id") REFERENCES "completed_orders"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_intents" ADD CONSTRAINT "fiscal_intents_connection_id_merchant_id_environment_fkey" FOREIGN KEY ("connection_id", "merchant_id", "environment") REFERENCES "fiscal_connections"("id", "merchant_id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_intents" ADD CONSTRAINT "fiscal_intents_profile_version_id_merchant_id_environment_fkey" FOREIGN KEY ("profile_version_id", "merchant_id", "environment") REFERENCES "fiscal_profile_versions"("id", "merchant_id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_intents" ADD CONSTRAINT "fiscal_intents_snapshot_id_merchant_id_environment_fkey" FOREIGN KEY ("snapshot_id", "merchant_id", "environment") REFERENCES "fiscal_sale_snapshots"("id", "merchant_id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_intent_id_merchant_id_environment_fkey" FOREIGN KEY ("intent_id", "merchant_id", "environment") REFERENCES "fiscal_intents"("id", "merchant_id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_artifacts" ADD CONSTRAINT "fiscal_artifacts_document_id_merchant_id_environment_fkey" FOREIGN KEY ("document_id", "merchant_id", "environment") REFERENCES "fiscal_documents"("id", "merchant_id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_events" ADD CONSTRAINT "fiscal_events_intent_id_merchant_id_environment_fkey" FOREIGN KEY ("intent_id", "merchant_id", "environment") REFERENCES "fiscal_intents"("id", "merchant_id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_deliveries" ADD CONSTRAINT "fiscal_deliveries_document_id_merchant_id_environment_fkey" FOREIGN KEY ("document_id", "merchant_id", "environment") REFERENCES "fiscal_documents"("id", "merchant_id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_cancellation_reviews" ADD CONSTRAINT "fiscal_cancellation_reviews_document_id_merchant_id_enviro_fkey" FOREIGN KEY ("document_id", "merchant_id", "environment") REFERENCES "fiscal_documents"("id", "merchant_id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fiscal custom invariants
-- The integration fixture executes this exact tail after prisma db push.
-- Keep these rules in this production migration as their single SQL source.
CREATE UNIQUE INDEX "fiscal_connections_one_active"
ON "fiscal_connections" ("merchant_id", "environment") WHERE "is_active";

ALTER TABLE "fiscal_connections" ADD CONSTRAINT "fiscal_connections_active_state"
CHECK (NOT "is_active" OR ("activated_at" IS NOT NULL AND "disconnected_at" IS NULL));

ALTER TABLE "fiscal_profile_versions" ADD CONSTRAINT "fiscal_profiles_confirmation"
CHECK ("version" > 0 AND (("confirmed_at" IS NULL AND "confirmed_by" IS NULL)
  OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL AND length(btrim("confirmed_by")) > 0)));

ALTER TABLE "fiscal_sale_snapshots" ADD CONSTRAINT "fiscal_snapshots_amounts"
CHECK ("subtotal_cents" >= 0 AND "discount_cents" >= 0 AND "shipping_cents" >= 0
  AND "discount_cents" <= "subtotal_cents" AND "total_cents" >= 0
  AND "total_cents"::bigint = "subtotal_cents"::bigint - "discount_cents"::bigint + "shipping_cents"::bigint);
ALTER TABLE "fiscal_sale_snapshots" ADD CONSTRAINT "fiscal_snapshots_hash"
CHECK ("content_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "fiscal_intents" ADD CONSTRAINT "fiscal_intents_state"
CHECK ("state" IN ('awaiting_payment','not_eligible_before_activation','queued','processing',
  'reconciliation_required','action_required','rejected','authorized','cancelled','suppressed')
  AND "operation" = 'sale' AND "attempts" >= 0 AND "version" >= 0
  AND length(btrim("stable_reference")) BETWEEN 1 AND 100);

ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_evidence"
CHECK ("state" IN ('processing','rejected','authorized','cancelled')
  AND "document_state" IN ('document_pending','available')
  AND ("state" NOT IN ('authorized','cancelled') OR
    (length(btrim("number")) > 0 AND length(btrim("series")) > 0
      AND length(btrim("access_key")) > 0 AND length(btrim("authorization_protocol")) > 0
      AND "number" IS NOT NULL AND "series" IS NOT NULL AND "access_key" IS NOT NULL
      AND "authorization_protocol" IS NOT NULL AND "authorized_at" IS NOT NULL))
  AND ("state" <> 'cancelled' OR ("cancellation_protocol" IS NOT NULL
    AND length(btrim("cancellation_protocol")) > 0 AND "cancelled_at" IS NOT NULL)));

ALTER TABLE "fiscal_artifacts" ADD CONSTRAINT "fiscal_artifacts_content"
CHECK ("size" BETWEEN 1 AND 20971520 AND octet_length("content") = "size"
  AND "sha256" ~ '^[0-9a-f]{64}$' AND length(btrim("private_object_key")) > 0
  AND (("kind" = 'xml' AND "mime_type" IN ('application/xml','text/xml'))
    OR ("kind" = 'danfe' AND "mime_type" = 'application/pdf')));

ALTER TABLE "fiscal_deliveries" ADD CONSTRAINT "fiscal_deliveries_state"
CHECK ("channel" IN ('email','whatsapp') AND "state" IN
  ('queued','sending','blocked','accepted','delivered','delivery_unknown','failed')
  AND "attempts" >= 0 AND "version" >= 0 AND length(btrim("responsible_sender")) > 0);

ALTER TABLE "fiscal_cancellation_reviews" ADD CONSTRAINT "fiscal_cancellations_confirmation"
CHECK (("confirmed_at" IS NULL AND "confirmed_by" IS NULL)
  OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL AND length(btrim("confirmed_by")) > 0));

CREATE FUNCTION "fiscal_preserve_confirmed_document"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN ('authorized','cancelled') THEN
    IF ROW(NEW.merchant_id, NEW.environment, NEW.intent_id, NEW.issuer_tax_id,
      NEW.number, NEW.series, NEW.access_key, NEW.authorization_protocol, NEW.authorized_at)
      IS DISTINCT FROM ROW(OLD.merchant_id, OLD.environment, OLD.intent_id, OLD.issuer_tax_id,
        OLD.number, OLD.series, OLD.access_key, OLD.authorization_protocol, OLD.authorized_at)
      OR NEW.state NOT IN ('authorized','cancelled') THEN
      RAISE EXCEPTION 'fiscal_authorized_document_immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.state = 'cancelled' AND (NEW.state <> 'cancelled'
    OR ROW(NEW.cancellation_protocol, NEW.cancelled_at)
      IS DISTINCT FROM ROW(OLD.cancellation_protocol, OLD.cancelled_at)) THEN
    RAISE EXCEPTION 'fiscal_cancelled_document_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fiscal_documents_preserve_confirmation"
BEFORE UPDATE ON "fiscal_documents" FOR EACH ROW
EXECUTE FUNCTION "fiscal_preserve_confirmed_document"();

CREATE FUNCTION "fiscal_preserve_history"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fiscal_history_immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "fiscal_events_append_only"
BEFORE UPDATE OR DELETE ON "fiscal_events" FOR EACH ROW
EXECUTE FUNCTION "fiscal_preserve_history"();
