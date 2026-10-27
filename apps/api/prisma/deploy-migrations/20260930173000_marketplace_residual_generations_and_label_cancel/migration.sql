-- DropIndex
DROP INDEX IF EXISTS "marketplace_residual_plans_funding_plan_id_key";

-- AlterTable
ALTER TABLE "marketplace_residual_plans" ADD COLUMN IF NOT EXISTS "generation" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "marketplace_transfer_reversals" ADD COLUMN IF NOT EXISTS "residual_operation_id" TEXT,
ALTER COLUMN "payout_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "marketplace_shipment_journals" ADD COLUMN IF NOT EXISTS "canceled_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancellation_claimed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT,
ADD COLUMN IF NOT EXISTS "cancellation_receipt" JSONB,
ADD COLUMN IF NOT EXISTS "cancellation_receipt_hash" TEXT,
ADD COLUMN IF NOT EXISTS "cancellation_status" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_residual_plans_funding_plan_id_generation_key" ON "marketplace_residual_plans"("funding_plan_id", "generation");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_residual_plans_funding_plan_id_basis_hash_key" ON "marketplace_residual_plans"("funding_plan_id", "basis_hash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_transfer_reversals_refund_plan_id_residual_oper_key" ON "marketplace_transfer_reversals"("refund_plan_id", "residual_operation_id");

-- AddForeignKey
ALTER TABLE "marketplace_transfer_reversals" DROP CONSTRAINT IF EXISTS "marketplace_transfer_reversals_residual_operation_id_fkey";
ALTER TABLE "marketplace_transfer_reversals" ADD CONSTRAINT "marketplace_transfer_reversals_residual_operation_id_fkey" FOREIGN KEY ("residual_operation_id") REFERENCES "marketplace_residual_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE marketplace_transfer_reversals DROP CONSTRAINT IF EXISTS marketplace_transfer_reversal_target_valid;
ALTER TABLE marketplace_transfer_reversals ADD CONSTRAINT marketplace_transfer_reversal_target_valid CHECK ((payout_id IS NULL) <> (residual_operation_id IS NULL));

-- Preserve v1 journals and admit v2 only when the original retained transfers
-- are included in the conservation equation. No historical journal is rewritten.
CREATE OR REPLACE FUNCTION marketplace_residual_allocation_valid(a JSONB) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k TEXT; b JSONB; total NUMERIC := 0; transferred NUMERIC := 0; v2 BOOLEAN;
BEGIN
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR a->'version' NOT IN ('1'::jsonb,'2'::jsonb,'3'::jsonb)
   OR a->'version' IS NULL OR jsonb_typeof(a->'beneficiaries') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 v2 := a->'version' IN ('2'::jsonb,'3'::jsonb);
 FOREACH k IN ARRAY ARRAY['capturedNetCents','refundedCents','platformRetainedCents','payoutTotalCents'] LOOP
   IF jsonb_typeof(a->k) IS DISTINCT FROM 'number' OR (a->>k)::numeric<0 OR (a->>k)::numeric>2147483647 OR trunc((a->>k)::numeric)<>(a->>k)::numeric THEN RETURN false; END IF;
 END LOOP;
 IF v2 AND (jsonb_typeof(a->'alreadyTransferredCents') IS DISTINCT FROM 'number' OR
   (a->>'alreadyTransferredCents')::numeric<0 OR (a->>'alreadyTransferredCents')::numeric>2147483647 OR
   trunc((a->>'alreadyTransferredCents')::numeric)<>(a->>'alreadyTransferredCents')::numeric) THEN RETURN false; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(a->'beneficiaries') LOOP
   IF jsonb_typeof(b->'merchantId') IS DISTINCT FROM 'string' OR jsonb_typeof(b->'destination') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
   FOREACH k IN ARRAY ARRAY['amountCents','providerFeeCents'] LOOP
     IF jsonb_typeof(b->k) IS DISTINCT FROM 'number' OR (b->>k)::numeric<0 OR (b->>k)::numeric>2147483647 OR trunc((b->>k)::numeric)<>(b->>k)::numeric THEN RETURN false; END IF;
   END LOOP;
   total := total+(b->>'amountCents')::numeric;
   IF v2 THEN
     IF jsonb_typeof(b->'alreadyTransferredCents') IS DISTINCT FROM 'number' OR
       (b->>'alreadyTransferredCents')::numeric<0 OR (b->>'alreadyTransferredCents')::numeric>2147483647 OR
       trunc((b->>'alreadyTransferredCents')::numeric)<>(b->>'alreadyTransferredCents')::numeric THEN RETURN false; END IF;
     transferred := transferred+(b->>'alreadyTransferredCents')::numeric;
   END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'merchantId') FROM jsonb_array_elements(a->'beneficiaries'))<>jsonb_array_length(a->'beneficiaries') THEN RETURN false; END IF;
 RETURN (a->>'refundedCents')::numeric>0 AND total=(a->>'payoutTotalCents')::numeric
   AND (NOT v2 OR transferred=(a->>'alreadyTransferredCents')::numeric)
   AND (a->>'capturedNetCents')::numeric=(a->>'refundedCents')::numeric+(a->>'platformRetainedCents')::numeric+total+transferred;
END $$;


ALTER TABLE marketplace_residual_plans DROP CONSTRAINT IF EXISTS marketplace_residual_plan_valid;
ALTER TABLE marketplace_residual_plans ADD CONSTRAINT marketplace_residual_plan_valid CHECK (COALESCE((
 status IN ('prepared','completed','held') AND generation > 0 AND basis_hash ~ '^[a-f0-9]{64}$' AND allocation_hash ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof(basis)='object' AND basis->'version'=allocation->'version'
 AND (generation=1 AND (basis->'version'='1'::jsonb OR basis->'version'='2'::jsonb
   AND jsonb_typeof(basis->'originalTransfers')='array' AND jsonb_array_length(basis->'originalTransfers')>0)
  OR generation>1 AND basis->'version'='3'::jsonb AND jsonb_typeof(basis->'originalTransfers')='array'
   AND jsonb_typeof(basis->'previousGenerations')='array' AND jsonb_array_length(basis->'previousGenerations')=generation-1)
 AND marketplace_residual_allocation_valid(allocation)
),false));

CREATE OR REPLACE FUNCTION marketplace_shipment_journal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version','carrier_order_id','claimed_at','reconciled_at','tracking_code','tracking_status','block_reason','updated_at','carrier_purchase_id','purchase_receipt','purchase_receipt_hash','purchase_claimed_at','purchased_at','generation_claimed_at','generation_receipt','generation_receipt_hash','generated_at','cancellation_status','cancellation_reason','cancellation_claimed_at','cancellation_receipt','cancellation_receipt_hash','canceled_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','carrier_order_id','claimed_at','reconciled_at','tracking_code','tracking_status','block_reason','updated_at','carrier_purchase_id','purchase_receipt','purchase_receipt_hash','purchase_claimed_at','purchased_at','generation_claimed_at','generation_receipt','generation_receipt_hash','generated_at','cancellation_status','cancellation_reason','cancellation_claimed_at','cancellation_receipt','cancellation_receipt_hash','canceled_at']) THEN RAISE EXCEPTION 'marketplace_shipment_journal_immutable'; END IF;
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

ALTER TABLE marketplace_shipment_journals DROP CONSTRAINT IF EXISTS marketplace_shipment_cancellation_valid;
ALTER TABLE marketplace_shipment_journals ADD CONSTRAINT marketplace_shipment_cancellation_valid CHECK (COALESCE((
 (cancellation_status IS NULL AND cancellation_reason IS NULL AND cancellation_claimed_at IS NULL AND cancellation_receipt IS NULL AND cancellation_receipt_hash IS NULL AND canceled_at IS NULL)
 OR
 (cancellation_status IN ('unknown','canceled') AND cancellation_reason IN ('merchant_request','return','dispute')
  AND cancellation_claimed_at IS NOT NULL AND status IN ('purchased','generated') AND purchased_at IS NOT NULL
  AND carrier_order_id IS NOT NULL AND purchase_receipt_hash IS NOT NULL
  AND (cancellation_status='unknown' AND cancellation_receipt IS NULL AND cancellation_receipt_hash IS NULL AND canceled_at IS NULL
   OR cancellation_status='canceled' AND canceled_at IS NOT NULL AND cancellation_receipt_hash ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(cancellation_receipt)='object' AND cancellation_receipt->'version'='1'::jsonb
   AND cancellation_receipt->>'carrierOrderId'=carrier_order_id AND cancellation_receipt->>'requestHash'=request_hash
   AND cancellation_receipt->>'purchaseReceiptHash'=purchase_receipt_hash
   AND (cancellation_receipt->>'generationReceiptHash') IS NOT DISTINCT FROM generation_receipt_hash
   AND cancellation_receipt->>'paidAt'=purchase_receipt->>'paidAt'
   AND (cancellation_receipt->>'generatedAt') IS NOT DISTINCT FROM (generation_receipt->>'generatedAt')
   AND jsonb_typeof(cancellation_receipt->'canceledAt')='string'
   AND cancellation_receipt->>'walletRefundStatus'='unproven'))
),false));

CREATE OR REPLACE FUNCTION marketplace_shipment_cancellation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.cancellation_status='canceled' AND (NEW.cancellation_status IS DISTINCT FROM OLD.cancellation_status OR
   NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason OR NEW.cancellation_claimed_at IS DISTINCT FROM OLD.cancellation_claimed_at OR
   NEW.cancellation_receipt IS DISTINCT FROM OLD.cancellation_receipt OR NEW.cancellation_receipt_hash IS DISTINCT FROM OLD.cancellation_receipt_hash OR
   NEW.canceled_at IS DISTINCT FROM OLD.canceled_at) THEN RAISE EXCEPTION 'marketplace_shipment_cancellation_terminal'; END IF;
 IF OLD.cancellation_status='unknown' AND NEW.cancellation_status IS NOT NULL AND
   (NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason OR NEW.cancellation_claimed_at IS DISTINCT FROM OLD.cancellation_claimed_at)
   THEN RAISE EXCEPTION 'marketplace_shipment_cancellation_claim_immutable'; END IF;
 IF OLD.cancellation_status IS NULL AND NEW.cancellation_status='canceled' THEN RAISE EXCEPTION 'marketplace_shipment_cancellation_claim_required'; END IF;
 IF (OLD.cancellation_status IS NOT NULL OR NEW.cancellation_status IS NOT NULL) AND NEW.status IS DISTINCT FROM OLD.status
   THEN RAISE EXCEPTION 'marketplace_shipment_cancellation_preserve_stage'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_shipment_cancellation_immutable_trigger ON marketplace_shipment_journals;
CREATE TRIGGER marketplace_shipment_cancellation_immutable_trigger BEFORE UPDATE ON marketplace_shipment_journals FOR EACH ROW EXECUTE FUNCTION marketplace_shipment_cancellation_immutable();
