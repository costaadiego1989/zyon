-- CreateTable
CREATE TABLE IF NOT EXISTS "marketplace_residual_plans" (
    "id" TEXT NOT NULL,
    "funding_plan_id" TEXT NOT NULL,
    "host_merchant_id" TEXT NOT NULL,
    "basis" JSONB NOT NULL,
    "basis_hash" TEXT NOT NULL,
    "allocation" JSONB NOT NULL,
    "allocation_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "held_reason" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_residual_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "marketplace_residual_operations" (
    "id" TEXT NOT NULL,
    "residual_plan_id" TEXT NOT NULL,
    "beneficiary_merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "account_fingerprint" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "request_hash" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "version" INTEGER NOT NULL DEFAULT 0,
    "provider_transfer_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_residual_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "marketplace_transfer_reversals" (
    "id" TEXT NOT NULL,
    "refund_plan_id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "host_merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "account_fingerprint" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "request" JSONB NOT NULL,
    "request_hash" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "version" INTEGER NOT NULL DEFAULT 0,
    "provider_operation_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_transfer_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "marketplace_shipment_journals" (
    "id" TEXT NOT NULL,
    "funding_plan_id" TEXT NOT NULL,
    "host_merchant_id" TEXT NOT NULL,
    "origin_merchant_id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "quote_key" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "account_fingerprint" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "request_hash" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "version" INTEGER NOT NULL DEFAULT 0,
    "carrier_order_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "tracking_code" TEXT,
    "tracking_status" TEXT,
    "block_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_shipment_journals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_residual_plans_funding_plan_id_key" ON "marketplace_residual_plans"("funding_plan_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_residual_plans_status_updated_at_idx" ON "marketplace_residual_plans"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_residual_operations_reference_key" ON "marketplace_residual_operations"("reference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_residual_operations_status_updated_at_idx" ON "marketplace_residual_operations"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_residual_operations_residual_plan_id_beneficiar_key" ON "marketplace_residual_operations"("residual_plan_id", "beneficiary_merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_residual_operations_receipt_key" ON "marketplace_residual_operations"("provider", "account_fingerprint", "provider_transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_transfer_reversals_reference_key" ON "marketplace_transfer_reversals"("reference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_transfer_reversals_status_updated_at_idx" ON "marketplace_transfer_reversals"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_transfer_reversals_refund_plan_id_payout_id_key" ON "marketplace_transfer_reversals"("refund_plan_id", "payout_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_transfer_reversals_receipt_key" ON "marketplace_transfer_reversals"("provider", "account_fingerprint", "provider_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_shipment_journals_reference_key" ON "marketplace_shipment_journals"("reference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_shipment_journals_status_updated_at_idx" ON "marketplace_shipment_journals"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_shipment_journals_funding_plan_id_origin_mercha_key" ON "marketplace_shipment_journals"("funding_plan_id", "origin_merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_shipment_journals_receipt_key" ON "marketplace_shipment_journals"("environment", "account_fingerprint", "carrier_order_id");

-- AddForeignKey
ALTER TABLE "marketplace_residual_plans" DROP CONSTRAINT IF EXISTS "marketplace_residual_plans_funding_plan_id_fkey";
ALTER TABLE "marketplace_residual_plans" ADD CONSTRAINT "marketplace_residual_plans_funding_plan_id_fkey" FOREIGN KEY ("funding_plan_id") REFERENCES "marketplace_funding_plans"("payment_intent_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_residual_operations" DROP CONSTRAINT IF EXISTS "marketplace_residual_operations_residual_plan_id_fkey";
ALTER TABLE "marketplace_residual_operations" ADD CONSTRAINT "marketplace_residual_operations_residual_plan_id_fkey" FOREIGN KEY ("residual_plan_id") REFERENCES "marketplace_residual_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_transfer_reversals" DROP CONSTRAINT IF EXISTS "marketplace_transfer_reversals_refund_plan_id_fkey";
ALTER TABLE "marketplace_transfer_reversals" ADD CONSTRAINT "marketplace_transfer_reversals_refund_plan_id_fkey" FOREIGN KEY ("refund_plan_id") REFERENCES "marketplace_refund_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_transfer_reversals" DROP CONSTRAINT IF EXISTS "marketplace_transfer_reversals_payout_id_fkey";
ALTER TABLE "marketplace_transfer_reversals" ADD CONSTRAINT "marketplace_transfer_reversals_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "marketplace_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_shipment_journals" DROP CONSTRAINT IF EXISTS "marketplace_shipment_journals_funding_plan_id_fkey";
ALTER TABLE "marketplace_shipment_journals" ADD CONSTRAINT "marketplace_shipment_journals_funding_plan_id_fkey" FOREIGN KEY ("funding_plan_id") REFERENCES "marketplace_funding_plans"("payment_intent_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE OR REPLACE FUNCTION marketplace_residual_allocation_valid(a JSONB) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k TEXT; b JSONB; total NUMERIC := 0;
BEGIN
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR a->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(a->'beneficiaries') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['capturedNetCents','refundedCents','platformRetainedCents','payoutTotalCents'] LOOP
   IF jsonb_typeof(a->k) IS DISTINCT FROM 'number' OR (a->>k)::numeric < 0 OR (a->>k)::numeric > 2147483647 OR trunc((a->>k)::numeric)<>(a->>k)::numeric THEN RETURN false; END IF;
 END LOOP;
 FOR b IN SELECT value FROM jsonb_array_elements(a->'beneficiaries') LOOP
   IF jsonb_typeof(b->'merchantId') IS DISTINCT FROM 'string' OR jsonb_typeof(b->'destination') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
   FOREACH k IN ARRAY ARRAY['amountCents','providerFeeCents'] LOOP
     IF jsonb_typeof(b->k) IS DISTINCT FROM 'number' OR (b->>k)::numeric<0 OR (b->>k)::numeric>2147483647 OR trunc((b->>k)::numeric)<>(b->>k)::numeric THEN RETURN false; END IF;
   END LOOP;
   total := total+(b->>'amountCents')::numeric;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'merchantId') FROM jsonb_array_elements(a->'beneficiaries'))<>jsonb_array_length(a->'beneficiaries') THEN RETURN false; END IF;
 RETURN (a->>'refundedCents')::numeric>0 AND total=(a->>'payoutTotalCents')::numeric AND (a->>'capturedNetCents')::numeric=(a->>'refundedCents')::numeric+(a->>'platformRetainedCents')::numeric+total;
END $$;

ALTER TABLE marketplace_residual_plans DROP CONSTRAINT IF EXISTS marketplace_residual_plan_valid;
ALTER TABLE marketplace_residual_plans ADD CONSTRAINT marketplace_residual_plan_valid CHECK (COALESCE((status IN ('prepared','completed','held') AND basis_hash ~ '^[a-f0-9]{64}$' AND allocation_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(basis)='object' AND marketplace_residual_allocation_valid(allocation)), false));

ALTER TABLE marketplace_residual_operations DROP CONSTRAINT IF EXISTS marketplace_residual_operations_valid;
ALTER TABLE marketplace_residual_operations ADD CONSTRAINT marketplace_residual_operations_valid CHECK (COALESCE((status IN ('planned','unknown','pending','confirmed','failed','cancelled') AND version >= 0 AND amount_cents > 0 AND provider='stripe' AND request_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(request)='object' AND request->>'requestHash'=request_hash AND request->>'reference'=reference AND request->>'provider'=provider AND request->>'accountFingerprint'=account_fingerprint AND jsonb_typeof(request->'amountCents')='number' AND (request->>'amountCents')::numeric=amount_cents AND (status NOT IN ('confirmed','failed') OR provider_transfer_id IS NOT NULL)), false));
CREATE OR REPLACE FUNCTION marketplace_residual_operations_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version','provider_transfer_id','claimed_at','reconciled_at','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','provider_transfer_id','claimed_at','reconciled_at','updated_at']) THEN RAISE EXCEPTION 'marketplace_residual_operations_immutable'; END IF;
 IF OLD.provider_transfer_id IS NOT NULL AND NEW.provider_transfer_id IS DISTINCT FROM OLD.provider_transfer_id THEN RAISE EXCEPTION 'marketplace_residual_operations_receipt_immutable'; END IF;
 IF OLD.status IN ('confirmed','failed','cancelled') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_residual_operations_terminal'; END IF;
 IF NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'marketplace_residual_operations_version_required'; END IF;
 IF OLD.status<>'planned' AND NEW.status='planned' AND (OLD.status<>'unknown' OR OLD.provider_transfer_id IS NOT NULL OR NEW.claimed_at IS NOT NULL) THEN RAISE EXCEPTION 'marketplace_residual_operations_submission_uncertain'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_residual_operations_immutable_trigger ON marketplace_residual_operations;
CREATE TRIGGER marketplace_residual_operations_immutable_trigger BEFORE UPDATE ON marketplace_residual_operations FOR EACH ROW EXECUTE FUNCTION marketplace_residual_operations_immutable();

ALTER TABLE marketplace_transfer_reversals DROP CONSTRAINT IF EXISTS marketplace_transfer_reversals_valid;
ALTER TABLE marketplace_transfer_reversals ADD CONSTRAINT marketplace_transfer_reversals_valid CHECK (COALESCE((status IN ('planned','unknown','pending','confirmed','failed') AND version >= 0 AND amount_cents > 0 AND provider='stripe' AND request_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(request)='object' AND request->>'requestHash'=request_hash AND request->>'reference'=reference AND request->>'provider'=provider AND request->>'accountFingerprint'=account_fingerprint AND jsonb_typeof(request->'amountCents')='number' AND (request->>'amountCents')::numeric=amount_cents AND (status NOT IN ('confirmed','failed') OR provider_operation_id IS NOT NULL)), false));
CREATE OR REPLACE FUNCTION marketplace_transfer_reversals_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version','provider_operation_id','claimed_at','reconciled_at','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','provider_operation_id','claimed_at','reconciled_at','updated_at']) THEN RAISE EXCEPTION 'marketplace_transfer_reversals_immutable'; END IF;
 IF OLD.provider_operation_id IS NOT NULL AND NEW.provider_operation_id IS DISTINCT FROM OLD.provider_operation_id THEN RAISE EXCEPTION 'marketplace_transfer_reversals_receipt_immutable'; END IF;
 IF OLD.status IN ('confirmed','failed','cancelled') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_transfer_reversals_terminal'; END IF;
 IF NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'marketplace_transfer_reversals_version_required'; END IF;
 IF OLD.status<>'planned' AND NEW.status='planned' AND (OLD.status<>'unknown' OR OLD.provider_operation_id IS NOT NULL OR NEW.claimed_at IS NOT NULL) THEN RAISE EXCEPTION 'marketplace_transfer_reversals_submission_uncertain'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_transfer_reversals_immutable_trigger ON marketplace_transfer_reversals;
CREATE TRIGGER marketplace_transfer_reversals_immutable_trigger BEFORE UPDATE ON marketplace_transfer_reversals FOR EACH ROW EXECUTE FUNCTION marketplace_transfer_reversals_immutable();
CREATE OR REPLACE FUNCTION marketplace_residual_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','held_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','held_reason','updated_at']) THEN RAISE EXCEPTION 'marketplace_residual_plan_immutable'; END IF;
 IF OLD.status='held' AND NEW.status<>'held' OR OLD.status='completed' AND NEW.status NOT IN ('completed','held') THEN RAISE EXCEPTION 'marketplace_residual_plan_terminal'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_residual_plan_immutable_trigger ON marketplace_residual_plans;
CREATE TRIGGER marketplace_residual_plan_immutable_trigger BEFORE UPDATE ON marketplace_residual_plans FOR EACH ROW EXECUTE FUNCTION marketplace_residual_plan_immutable();

ALTER TABLE marketplace_shipment_journals DROP CONSTRAINT IF EXISTS marketplace_shipment_journal_valid;
ALTER TABLE marketplace_shipment_journals ADD CONSTRAINT marketplace_shipment_journal_valid CHECK (COALESCE((status IN ('prepared','cart_unknown','cart_created','purchase_unknown','purchased','generate_unknown','generated','blocked') AND version>=0 AND environment IN ('test','live') AND request_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(request)='object' AND (status NOT IN ('cart_created','purchase_unknown','purchased','generate_unknown','generated') OR carrier_order_id IS NOT NULL)), false));
CREATE OR REPLACE FUNCTION marketplace_shipment_journal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version','carrier_order_id','claimed_at','reconciled_at','tracking_code','tracking_status','block_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','carrier_order_id','claimed_at','reconciled_at','tracking_code','tracking_status','block_reason','updated_at']) THEN RAISE EXCEPTION 'marketplace_shipment_journal_immutable'; END IF;
 IF OLD.carrier_order_id IS NOT NULL AND NEW.carrier_order_id IS DISTINCT FROM OLD.carrier_order_id THEN RAISE EXCEPTION 'marketplace_shipment_receipt_immutable'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'marketplace_shipment_version_required'; END IF;
 IF OLD.status='blocked' AND NEW.status<>'blocked' THEN RAISE EXCEPTION 'marketplace_shipment_terminal'; END IF;
 IF OLD.status<>'prepared' AND NEW.status='prepared' AND (OLD.status<>'cart_unknown' OR OLD.carrier_order_id IS NOT NULL OR NEW.claimed_at IS NOT NULL) THEN RAISE EXCEPTION 'marketplace_shipment_submission_uncertain'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_shipment_journal_immutable_trigger ON marketplace_shipment_journals;
CREATE TRIGGER marketplace_shipment_journal_immutable_trigger BEFORE UPDATE ON marketplace_shipment_journals FOR EACH ROW EXECUTE FUNCTION marketplace_shipment_journal_immutable();

CREATE OR REPLACE FUNCTION marketplace_refund_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.funding_plan_id, NEW.host_merchant_id, NEW.return_id, NEW.input_hash, NEW.allocation, NEW.allocation_hash, NEW.amount_cents, NEW.block_reason, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.funding_plan_id, OLD.host_merchant_id, OLD.return_id, OLD.input_hash, OLD.allocation, OLD.allocation_hash, OLD.amount_cents, OLD.block_reason, OLD.created_at) THEN
    RAISE EXCEPTION 'marketplace_refund_plan_immutable';
  END IF;
  IF OLD.status IN ('blocked','confirmed','failed') AND NEW.status<>OLD.status THEN
   IF NOT (OLD.status='blocked' AND NEW.status='prepared' AND OLD.block_reason='marketplace_refund_transfer_reversal_required'
     AND NOT EXISTS(SELECT 1 FROM marketplace_transfer_reversals r WHERE r.refund_plan_id=OLD.id AND r.status<>'confirmed')
     AND EXISTS(SELECT 1 FROM marketplace_refund_operations o WHERE o.refund_plan_id=OLD.id AND o.status='planned'
       AND o.request->>'kind'='refund' AND o.request->>'requestHash'=o.request_hash AND (o.request->>'amountCents')::numeric=OLD.amount_cents))
   THEN RAISE EXCEPTION 'marketplace_refund_plan_terminal'; END IF;
 END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_refund_plan_immutable_trigger ON marketplace_refund_plans;
CREATE TRIGGER marketplace_refund_plan_immutable_trigger BEFORE UPDATE ON marketplace_refund_plans FOR EACH ROW EXECUTE FUNCTION marketplace_refund_plan_immutable();
