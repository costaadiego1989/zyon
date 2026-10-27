ALTER TABLE marketplace_shipment_journals ADD COLUMN IF NOT EXISTS volume_index INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS marketplace_shipment_journals_funding_plan_id_origin_mercha_key;
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_shipment_journals_origin_volume_key
 ON marketplace_shipment_journals(funding_plan_id,origin_merchant_id,volume_index);

ALTER TABLE marketplace_shipment_journals DROP CONSTRAINT IF EXISTS marketplace_shipment_volume_identity;
ALTER TABLE marketplace_shipment_journals ADD CONSTRAINT marketplace_shipment_volume_identity CHECK (COALESCE(
 volume_index>=0 AND volume_index<100 AND (
  (request->'version'='1'::jsonb AND volume_index=0 AND NOT(request ? 'volumeIndex') AND NOT(request ? 'volumeCount')) OR
  (request->'version'='2'::jsonb AND request->'volumeIndex'=to_jsonb(volume_index)
   AND jsonb_typeof(request->'volumeCount')='number' AND (request->>'volumeCount')::numeric BETWEEN 2 AND 100
   AND (request->>'volumeCount')::numeric=trunc((request->>'volumeCount')::numeric)
   AND volume_index<(request->>'volumeCount')::integer
   AND jsonb_array_length(request#>'{body,volumes}')=1)),false));

-- Existing V1 request JSON and its hash are left byte-for-byte unchanged. The
-- existing immutable trigger also freezes the new volume_index column.
CREATE OR REPLACE FUNCTION marketplace_shipment_volume_group_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; q RECORD; j RECORD; binding JSONB; option JSONB; cq JSONB; contract JSONB; package JSONB;
 expected_products JSONB; actual_products JSONB; expected_count INTEGER; actual_count INTEGER; base_request JSONB; total BIGINT;
BEGIN
 IF NEW.request->'version'<>'2'::jsonb THEN RETURN NEW; END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=NEW.funding_plan_id;
 IF NOT FOUND OR f.host_merchant_id<>NEW.host_merchant_id OR f.provider_payment_id IS NULL THEN RAISE EXCEPTION 'marketplace_shipment_volume_binding_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 SELECT x INTO binding FROM jsonb_array_elements(f.instructions->'shippingQuotes') x
  WHERE x->>'merchantId'=NEW.origin_merchant_id;
 IF binding IS NULL OR binding->>'quoteId'<>NEW.quote_id OR binding->>'quoteKey'<>NEW.quote_key
  OR binding->>'carrierKey' NOT IN ('melhor-envio-1','melhor-envio-2','melhor-envio-17')
  OR encode(sha256(convert_to(marketplace_recovery_canonical(f.instructions),'UTF8')),'hex')<>f.instructions_hash THEN
  RAISE EXCEPTION 'marketplace_shipment_volume_binding_invalid'; END IF;
 SELECT * INTO q FROM shipping_quotes WHERE id=NEW.quote_id AND merchant_id=NEW.host_merchant_id;
 IF NOT FOUND OR q.quote_key<>NEW.quote_key OR q.selected_carrier_key IS DISTINCT FROM binding->>'carrierKey' THEN
  RAISE EXCEPTION 'marketplace_shipment_volume_quote_invalid'; END IF;
 SELECT x INTO option FROM jsonb_array_elements(q.results) x WHERE x->>'carrier_key'=binding->>'carrierKey';
 cq:=option->'marketplaceCarrierQuote'; contract:=option->'marketplaceShipmentContract';
 IF cq->'version' IS DISTINCT FROM '2'::jsonb OR cq->'amountCents' IS DISTINCT FROM binding->'amountCents'
  OR option->'price' IS DISTINCT FROM binding->'amountCents' OR option->>'currency' IS DISTINCT FROM 'BRL'
  OR cq->>'accountFingerprint' IS DISTINCT FROM NEW.account_fingerprint OR cq->>'environment' IS DISTINCT FROM NEW.environment
  OR contract->'version' IS DISTINCT FROM '2'::jsonb OR contract->>'merchantId' IS DISTINCT FROM NEW.origin_merchant_id
  OR encode(sha256(convert_to(marketplace_recovery_canonical(contract),'UTF8')),'hex') IS DISTINCT FROM split_part(binding->>'quoteKey',':',3)
  OR 'melhor-envio-'||(cq->>'serviceId') IS DISTINCT FROM binding->>'carrierKey'
  OR binding->>'carrierQuoteHash' IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(cq),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'marketplace_shipment_volume_quote_invalid'; END IF;
 expected_count:=jsonb_array_length(cq->'volumes');
 IF expected_count NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'marketplace_shipment_volume_quote_invalid'; END IF;
 SELECT jsonb_agg(item ORDER BY item->>'id' COLLATE "C") INTO actual_products FROM (
  SELECT jsonb_build_object('id',v->>'id','quantity',sum((v->>'quantity')::integer)) AS item
  FROM jsonb_array_elements(cq->'volumes') volume, jsonb_array_elements(volume->'products') v GROUP BY v->>'id') all_products;
 SELECT jsonb_agg(jsonb_build_object('id',p->>'lineItemId','quantity',p->'quantity') ORDER BY p->>'lineItemId' COLLATE "C")
  INTO expected_products FROM jsonb_array_elements(contract->'products') p;
 IF actual_products IS DISTINCT FROM expected_products OR
  (SELECT sum((v->>'insuranceCents')::bigint) FROM jsonb_array_elements(cq->'volumes') v) IS DISTINCT FROM (contract->>'insuranceTotalCents')::bigint THEN
  RAISE EXCEPTION 'marketplace_shipment_volume_conservation_invalid'; END IF;
 SELECT count(*) INTO actual_count FROM marketplace_shipment_journals
  WHERE funding_plan_id=NEW.funding_plan_id AND origin_merchant_id=NEW.origin_merchant_id;
 IF actual_count<>expected_count THEN RAISE EXCEPTION 'marketplace_shipment_volume_set_incomplete'; END IF;
 SELECT request INTO base_request FROM marketplace_shipment_journals
  WHERE funding_plan_id=NEW.funding_plan_id AND origin_merchant_id=NEW.origin_merchant_id AND volume_index=0;
 total:=0;
 FOR j IN SELECT * FROM marketplace_shipment_journals WHERE funding_plan_id=NEW.funding_plan_id AND origin_merchant_id=NEW.origin_merchant_id ORDER BY volume_index LOOP
  package:=cq->'volumes'->j.volume_index;
  IF (SELECT count(*)<>count(DISTINCT v->>'id') OR bool_or((v->>'quantity')::integer NOT BETWEEN 1 AND 99)
    FROM jsonb_array_elements(package->'products') v) OR
   (SELECT sum((p->>'unitValueCents')::bigint*(v->>'quantity')::integer)
    FROM jsonb_array_elements(package->'products') v JOIN jsonb_array_elements(contract->'products') p ON p->>'lineItemId'=v->>'id')
     IS DISTINCT FROM (package->>'insuranceCents')::bigint THEN RAISE EXCEPTION 'marketplace_shipment_volume_conservation_invalid'; END IF;
  IF package IS NULL OR j.host_merchant_id<>NEW.host_merchant_id OR j.quote_id<>NEW.quote_id OR j.quote_key<>NEW.quote_key
   OR j.environment<>NEW.environment OR j.account_fingerprint<>NEW.account_fingerprint
   OR j.request->'version' IS DISTINCT FROM '2'::jsonb OR j.request->'volumeCount' IS DISTINCT FROM to_jsonb(expected_count)
   OR j.request->'volumeIndex' IS DISTINCT FROM to_jsonb(j.volume_index)
   OR j.request->>'paymentIntentId' IS DISTINCT FROM NEW.funding_plan_id OR j.request->>'originMerchantId' IS DISTINCT FROM NEW.origin_merchant_id
   OR j.request->>'quoteId' IS DISTINCT FROM NEW.quote_id OR j.request->>'quoteKey' IS DISTINCT FROM NEW.quote_key
   OR j.request->>'environment' IS DISTINCT FROM NEW.environment OR j.request->>'accountFingerprint' IS DISTINCT FROM NEW.account_fingerprint
   OR j.request->>'carrierQuoteHash' IS DISTINCT FROM binding->>'carrierQuoteHash'
   OR j.request->'amountCents' IS DISTINCT FROM package->'amountCents' OR (package->>'amountCents')::integer<=0
   OR j.request#>'{body,service}' IS DISTINCT FROM cq->'serviceId'
   OR j.request#>'{body,from}' IS DISTINCT FROM base_request#>'{body,from}'
   OR j.request#>'{body,to}' IS DISTINCT FROM base_request#>'{body,to}'
   OR j.request#>'{body,options,invoice}' IS DISTINCT FROM base_request#>'{body,options,invoice}'
   OR j.request#>>'{body,from,postal_code}' IS DISTINCT FROM contract->>'originZip'
   OR j.request#>>'{body,to,postal_code}' IS DISTINCT FROM contract->>'destinationZip'
   OR j.request#>'{body,volumes}' IS DISTINCT FROM jsonb_build_array(package-ARRAY['products','insuranceCents','amountCents'])
   OR (j.request#>>'{body,options,insurance_value}')::numeric*100 IS DISTINCT FROM (package->>'insuranceCents')::numeric
   OR j.request_hash<>encode(sha256(convert_to(marketplace_recovery_canonical(j.request),'UTF8')),'hex')
   OR j.reference IS DISTINCT FROM 'mship_'||encode(sha256(convert_to(marketplace_recovery_canonical(jsonb_build_array(NEW.host_merchant_id,NEW.funding_plan_id,NEW.origin_merchant_id,j.volume_index)),'UTF8')),'hex')
   OR j.request->>'reference' IS DISTINCT FROM j.reference
   OR j.request#>'{body,options,tags}' IS DISTINCT FROM jsonb_build_array(jsonb_build_object('tag',j.reference,'url',NULL)) THEN
   RAISE EXCEPTION 'marketplace_shipment_volume_request_invalid'; END IF;
  SELECT jsonb_agg(item ORDER BY item::text COLLATE "C") INTO expected_products FROM (
   SELECT jsonb_build_object('quantity',v->'quantity','unitary_value',(p->>'unitValueCents')::numeric/100) AS item
   FROM jsonb_array_elements(package->'products') v JOIN jsonb_array_elements(contract->'products') p ON p->>'lineItemId'=v->>'id') values_by_product;
  SELECT jsonb_agg(x-'name' ORDER BY (x-'name')::text COLLATE "C") INTO actual_products FROM jsonb_array_elements(j.request#>'{body,products}') x;
  IF actual_products IS DISTINCT FROM expected_products THEN RAISE EXCEPTION 'marketplace_shipment_volume_products_invalid'; END IF;
  total:=total+(package->>'amountCents')::integer;
 END LOOP;
 IF total IS DISTINCT FROM (binding->>'amountCents')::bigint THEN RAISE EXCEPTION 'marketplace_shipment_volume_amount_invalid'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_shipment_volume_group_valid_trigger ON marketplace_shipment_journals;
CREATE CONSTRAINT TRIGGER marketplace_shipment_volume_group_valid_trigger
 AFTER INSERT OR UPDATE ON marketplace_shipment_journals DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION marketplace_shipment_volume_group_valid();
