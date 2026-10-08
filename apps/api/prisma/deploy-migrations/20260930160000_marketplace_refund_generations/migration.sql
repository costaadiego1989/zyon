-- Preserve v1 journals and admit v2 only when the original retained transfers
-- are included in the conservation equation. No historical journal is rewritten.
CREATE OR REPLACE FUNCTION marketplace_residual_allocation_valid(a JSONB) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k TEXT; b JSONB; total NUMERIC := 0; transferred NUMERIC := 0; v2 BOOLEAN;
BEGIN
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR a->'version' NOT IN ('1'::jsonb,'2'::jsonb)
   OR a->'version' IS NULL OR jsonb_typeof(a->'beneficiaries') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 v2 := a->'version'='2'::jsonb;
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
 status IN ('prepared','completed','held') AND basis_hash ~ '^[a-f0-9]{64}$' AND allocation_hash ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof(basis)='object' AND basis->'version'=allocation->'version'
 AND (basis->'version'='1'::jsonb OR basis->'version'='2'::jsonb
   AND jsonb_typeof(basis->'originalTransfers')='array' AND jsonb_array_length(basis->'originalTransfers')>0)
 AND marketplace_residual_allocation_valid(allocation)),false));
