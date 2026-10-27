-- AlterTable
ALTER TABLE "marketplace_shipment_journals" ADD COLUMN IF NOT EXISTS "carrier_purchase_id" TEXT,
ADD COLUMN IF NOT EXISTS "generated_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "generation_claimed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "generation_receipt" JSONB,
ADD COLUMN IF NOT EXISTS "generation_receipt_hash" TEXT,
ADD COLUMN IF NOT EXISTS "purchase_claimed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "purchase_receipt" JSONB,
ADD COLUMN IF NOT EXISTS "purchase_receipt_hash" TEXT,
ADD COLUMN IF NOT EXISTS "purchased_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "marketplace_cancellation_operations" (
    "id" TEXT NOT NULL,
    "funding_plan_id" TEXT NOT NULL,
    "host_merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "account_fingerprint" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "request_hash" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "version" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "block_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_cancellation_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_cancellation_operations_funding_plan_id_key" ON "marketplace_cancellation_operations"("funding_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_cancellation_operations_reference_key" ON "marketplace_cancellation_operations"("reference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_cancellation_operations_status_updated_at_idx" ON "marketplace_cancellation_operations"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_shipment_journals_purchase_key" ON "marketplace_shipment_journals"("environment", "account_fingerprint", "carrier_purchase_id");

-- AddForeignKey
ALTER TABLE "marketplace_cancellation_operations" DROP CONSTRAINT IF EXISTS "marketplace_cancellation_operations_funding_plan_id_fkey";
ALTER TABLE "marketplace_cancellation_operations" ADD CONSTRAINT "marketplace_cancellation_operations_funding_plan_id_fkey" FOREIGN KEY ("funding_plan_id") REFERENCES "marketplace_funding_plans"("payment_intent_id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE marketplace_cancellation_operations DROP CONSTRAINT IF EXISTS marketplace_cancellation_operation_valid;
ALTER TABLE marketplace_cancellation_operations ADD CONSTRAINT marketplace_cancellation_operation_valid CHECK (COALESCE((status IN ('planned','unknown','confirmed','blocked') AND version>=0 AND provider='stripe'
 AND jsonb_typeof(request)='object' AND request_hash ~ '^[a-f0-9]{64}$'
 AND request->>'requestHash'=request_hash AND request->>'reference'=reference AND request->>'provider'=provider
 AND request->>'hostMerchantId'=host_merchant_id AND request->>'paymentIntentId'=funding_plan_id
 AND request->>'accountFingerprint'=account_fingerprint AND request->>'currency'='BRL'
 AND request->'version'='1'::jsonb AND request->>'environment' IN ('test','live')
 AND request->>'cancellationReason' IN ('requested_by_customer','abandoned','duplicate','fraudulent')
 AND jsonb_typeof(request->'amountCents')='number' AND (request->>'amountCents')::numeric>0
 AND (request->>'amountCents')::numeric<=2147483647 AND trunc((request->>'amountCents')::numeric)=(request->>'amountCents')::numeric
 AND (status NOT IN ('unknown','confirmed') OR claimed_at IS NOT NULL)
 AND (status<>'confirmed' OR confirmed_at IS NOT NULL) AND (status<>'blocked' OR block_reason IS NOT NULL)),false));
CREATE OR REPLACE FUNCTION marketplace_cancellation_operation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version','claimed_at','reconciled_at','confirmed_at','block_reason','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','claimed_at','reconciled_at','confirmed_at','block_reason','updated_at']) THEN RAISE EXCEPTION 'marketplace_cancellation_operation_immutable'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'marketplace_cancellation_version_required'; END IF;
 IF OLD.status IN ('confirmed','blocked') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_cancellation_terminal'; END IF;
 IF NOT (NEW.status=OLD.status OR OLD.status='planned' AND NEW.status IN ('unknown','blocked') OR OLD.status='unknown' AND NEW.status IN ('confirmed','blocked')) THEN RAISE EXCEPTION 'marketplace_cancellation_transition_invalid'; END IF;
 IF OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN RAISE EXCEPTION 'marketplace_cancellation_claim_immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_cancellation_operation_immutable_trigger ON marketplace_cancellation_operations;
CREATE TRIGGER marketplace_cancellation_operation_immutable_trigger BEFORE UPDATE ON marketplace_cancellation_operations FOR EACH ROW EXECUTE FUNCTION marketplace_cancellation_operation_immutable();

ALTER TABLE marketplace_shipment_journals DROP CONSTRAINT IF EXISTS marketplace_shipment_purchase_valid;
ALTER TABLE marketplace_shipment_journals ADD CONSTRAINT marketplace_shipment_purchase_valid CHECK (COALESCE(((carrier_purchase_id IS NULL AND purchase_receipt IS NULL AND purchase_receipt_hash IS NULL OR
 carrier_purchase_id IS NOT NULL AND jsonb_typeof(purchase_receipt)='object' AND purchase_receipt_hash ~ '^[a-f0-9]{64}$'
 AND purchase_receipt->'version'='1'::jsonb AND purchase_receipt->>'carrierOrderId'=carrier_order_id
 AND purchase_receipt->>'carrierPurchaseId'=carrier_purchase_id AND purchase_receipt->>'requestHash'=request_hash
 AND purchase_receipt->>'currency'='BRL' AND purchase_receipt->'amountCents'=request->'amountCents'
 AND jsonb_typeof(purchase_receipt->'transactions')='array')
 AND (status NOT IN ('purchase_unknown','purchased','generate_unknown','generated') OR purchase_claimed_at IS NOT NULL)
 AND (status NOT IN ('purchased','generate_unknown','generated') OR purchased_at IS NOT NULL AND carrier_purchase_id IS NOT NULL)),false));

ALTER TABLE marketplace_shipment_journals DROP CONSTRAINT IF EXISTS marketplace_shipment_generation_valid;
ALTER TABLE marketplace_shipment_journals ADD CONSTRAINT marketplace_shipment_generation_valid CHECK (COALESCE(((generation_receipt IS NULL AND generation_receipt_hash IS NULL OR
 jsonb_typeof(generation_receipt)='object' AND generation_receipt_hash ~ '^[a-f0-9]{64}$' AND generation_receipt->'version'='1'::jsonb
 AND generation_receipt->>'carrierOrderId'=carrier_order_id AND generation_receipt->>'requestHash'=request_hash
 AND generation_receipt->>'purchaseReceiptHash'=purchase_receipt_hash AND generation_receipt->>'paidAt'=purchase_receipt->>'paidAt')
 AND (status NOT IN ('generate_unknown','generated') OR generation_claimed_at IS NOT NULL)
 AND (status<>'generated' OR generated_at IS NOT NULL AND generation_receipt IS NOT NULL)),false));
CREATE OR REPLACE FUNCTION marketplace_shipment_journal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version','carrier_order_id','claimed_at','reconciled_at','tracking_code','tracking_status','block_reason','updated_at','carrier_purchase_id','purchase_receipt','purchase_receipt_hash','purchase_claimed_at','purchased_at','generation_claimed_at','generation_receipt','generation_receipt_hash','generated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','carrier_order_id','claimed_at','reconciled_at','tracking_code','tracking_status','block_reason','updated_at','carrier_purchase_id','purchase_receipt','purchase_receipt_hash','purchase_claimed_at','purchased_at','generation_claimed_at','generation_receipt','generation_receipt_hash','generated_at']) THEN RAISE EXCEPTION 'marketplace_shipment_journal_immutable'; END IF;
 IF OLD.carrier_order_id IS NOT NULL AND NEW.carrier_order_id IS DISTINCT FROM OLD.carrier_order_id OR OLD.carrier_purchase_id IS NOT NULL AND NEW.carrier_purchase_id IS DISTINCT FROM OLD.carrier_purchase_id THEN RAISE EXCEPTION 'marketplace_shipment_receipt_immutable'; END IF;
 IF OLD.purchase_receipt IS NOT NULL AND (NEW.purchase_receipt IS DISTINCT FROM OLD.purchase_receipt OR NEW.purchase_receipt_hash IS DISTINCT FROM OLD.purchase_receipt_hash) OR
    OLD.generation_receipt IS NOT NULL AND (NEW.generation_receipt IS DISTINCT FROM OLD.generation_receipt OR NEW.generation_receipt_hash IS DISTINCT FROM OLD.generation_receipt_hash) THEN RAISE EXCEPTION 'marketplace_shipment_receipt_immutable'; END IF;
 IF OLD.purchased_at IS NOT NULL AND NEW.purchased_at IS DISTINCT FROM OLD.purchased_at OR OLD.generated_at IS NOT NULL AND NEW.generated_at IS DISTINCT FROM OLD.generated_at THEN RAISE EXCEPTION 'marketplace_shipment_confirmation_immutable'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'marketplace_shipment_version_required'; END IF;
 IF NOT (NEW.status=OLD.status OR
   OLD.status='prepared' AND NEW.status IN ('cart_unknown','blocked') OR
   OLD.status='cart_unknown' AND NEW.status IN ('prepared','cart_created','blocked') OR
   OLD.status='cart_created' AND NEW.status IN ('purchase_unknown','blocked') OR
   OLD.status='purchase_unknown' AND NEW.status IN ('cart_created','purchased','blocked') OR
   OLD.status='purchased' AND NEW.status IN ('generate_unknown','blocked') OR
   OLD.status='generate_unknown' AND NEW.status IN ('purchased','generated','blocked') OR
   OLD.status='generated' AND NEW.status='blocked') THEN RAISE EXCEPTION 'marketplace_shipment_transition_invalid'; END IF;
 IF OLD.status<>'prepared' AND NEW.status='prepared' AND (OLD.status<>'cart_unknown' OR OLD.carrier_order_id IS NOT NULL OR NEW.claimed_at IS NOT NULL) THEN RAISE EXCEPTION 'marketplace_shipment_submission_uncertain'; END IF;
 IF NEW.status='cart_created' AND OLD.status='purchase_unknown' AND (OLD.purchase_receipt IS NOT NULL OR NEW.purchase_receipt IS NOT NULL OR NEW.purchase_claimed_at IS NOT NULL) THEN RAISE EXCEPTION 'marketplace_shipment_purchase_uncertain'; END IF;
 IF NEW.status='purchased' AND OLD.status='generate_unknown' AND (OLD.generation_receipt IS NOT NULL OR NEW.generation_receipt IS NOT NULL OR NEW.generation_claimed_at IS NOT NULL) THEN RAISE EXCEPTION 'marketplace_shipment_generation_uncertain'; END IF;
 IF OLD.purchase_claimed_at IS NOT NULL AND NEW.purchase_claimed_at IS DISTINCT FROM OLD.purchase_claimed_at AND NOT (OLD.status='purchase_unknown' AND NEW.status='cart_created' AND NEW.purchase_claimed_at IS NULL) THEN RAISE EXCEPTION 'marketplace_shipment_purchase_claim_immutable'; END IF;
 IF OLD.generation_claimed_at IS NOT NULL AND NEW.generation_claimed_at IS DISTINCT FROM OLD.generation_claimed_at AND NOT (OLD.status='generate_unknown' AND NEW.status='purchased' AND NEW.generation_claimed_at IS NULL) THEN RAISE EXCEPTION 'marketplace_shipment_generation_claim_immutable'; END IF;
 RETURN NEW;
END $$;
