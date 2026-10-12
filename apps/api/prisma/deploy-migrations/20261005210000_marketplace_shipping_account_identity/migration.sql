-- Native owner binding for new quotations. Historical token-bound requests are
-- not rewritten or promoted; existing financial and volume guards remain active.
CREATE OR REPLACE FUNCTION marketplace_shipping_account_identity_valid(identity jsonb, env text, origin text, fingerprint text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_typeof(identity)='object'
  AND identity=jsonb_build_object('version',1,'provider','melhor-envio','environment',env,
      'originMerchantId',origin,'providerUserId',identity->>'providerUserId')
  AND env IN ('test','live') AND origin<>'' AND origin=btrim(origin) AND length(origin)<=200
  AND identity->>'providerUserId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  AND identity->>'providerUserId'<>'00000000-0000-0000-0000-000000000000'
  AND fingerprint=encode(sha256(convert_to(marketplace_recovery_canonical(identity),'UTF8')),'hex'),false)
$$;
ALTER TABLE marketplace_shipment_journals ADD CONSTRAINT marketplace_shipment_native_account_identity
 CHECK(NOT(request ? 'accountIdentity') OR marketplace_shipping_account_identity_valid(request->'accountIdentity',environment,origin_merchant_id,account_fingerprint));
-- One native receipt cannot pay or deliver two journals, even if two merchants
-- independently authorize the same carrier user and therefore have other scope hashes.
CREATE UNIQUE INDEX marketplace_shipment_native_order_identity_key ON marketplace_shipment_journals
 (environment,(request#>>'{accountIdentity,providerUserId}'),carrier_order_id)
 WHERE request ? 'accountIdentity' AND carrier_order_id IS NOT NULL;
CREATE UNIQUE INDEX marketplace_shipment_native_purchase_identity_key ON marketplace_shipment_journals
 (environment,(request#>>'{accountIdentity,providerUserId}'),carrier_purchase_id)
 WHERE request ? 'accountIdentity' AND carrier_purchase_id IS NOT NULL;

CREATE OR REPLACE FUNCTION marketplace_shipment_native_account_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; q RECORD; binding jsonb; option jsonb; cq jsonb;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=NEW.funding_plan_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'marketplace_shipment_native_account_binding_invalid'; END IF;
 SELECT value INTO binding FROM jsonb_array_elements(f.instructions->'shippingQuotes') WHERE value->>'merchantId'=NEW.origin_merchant_id;
 SELECT * INTO q FROM shipping_quotes WHERE id=NEW.quote_id AND merchant_id=NEW.host_merchant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'marketplace_shipment_native_account_binding_invalid'; END IF;
 SELECT value INTO option FROM jsonb_array_elements(q.results) WHERE value->>'carrier_key'=binding->>'carrierKey';
 cq:=option->'marketplaceCarrierQuote';
 IF NOT(NEW.request ? 'accountIdentity') AND NOT COALESCE(cq ? 'accountIdentity',false) THEN RETURN NEW; END IF;
 IF f.host_merchant_id IS DISTINCT FROM NEW.host_merchant_id OR binding IS NULL OR cq IS NULL
  OR encode(sha256(convert_to(marketplace_recovery_canonical(f.instructions),'UTF8')),'hex') IS DISTINCT FROM f.instructions_hash
  OR binding->>'quoteId' IS DISTINCT FROM NEW.quote_id OR binding->>'quoteKey' IS DISTINCT FROM NEW.quote_key
  OR binding->>'carrierKey' NOT IN ('melhor-envio-1','melhor-envio-2','melhor-envio-17')
  OR q.quote_key IS DISTINCT FROM NEW.quote_key OR q.selected_carrier_key IS DISTINCT FROM binding->>'carrierKey'
  OR cq->'accountIdentity' IS DISTINCT FROM NEW.request->'accountIdentity'
  OR NOT marketplace_shipping_account_identity_valid(cq->'accountIdentity',NEW.environment,NEW.origin_merchant_id,NEW.account_fingerprint)
  OR cq->>'environment' IS DISTINCT FROM NEW.environment OR cq->>'accountFingerprint' IS DISTINCT FROM NEW.account_fingerprint
  OR NEW.request->>'environment' IS DISTINCT FROM NEW.environment OR NEW.request->>'accountFingerprint' IS DISTINCT FROM NEW.account_fingerprint
  OR NEW.request->>'originMerchantId' IS DISTINCT FROM NEW.origin_merchant_id OR NEW.request->>'paymentIntentId' IS DISTINCT FROM NEW.funding_plan_id
  OR NEW.request->>'quoteId' IS DISTINCT FROM NEW.quote_id OR NEW.request->>'quoteKey' IS DISTINCT FROM NEW.quote_key
  OR NEW.request->>'carrierQuoteHash' IS DISTINCT FROM binding->>'carrierQuoteHash'
  OR binding->>'carrierQuoteHash' IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(cq),'UTF8')),'hex')
  OR NEW.request_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(NEW.request),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'marketplace_shipment_native_account_binding_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_shipment_native_account_binding_trigger
 AFTER INSERT OR UPDATE ON marketplace_shipment_journals DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION marketplace_shipment_native_account_binding_guard();
