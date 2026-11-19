-- Nullable historical channel. Legacy rows remain unproven; public session
-- mappers do not project these server-only creation fields.
ALTER TABLE checkout_sessions ADD COLUMN service_origin TEXT;
ALTER TABLE checkout_sessions ADD COLUMN service_origin_proof JSONB;
ALTER TABLE checkout_sessions ADD CONSTRAINT service_checkout_origin_shape CHECK (
  (service_origin IS NULL AND service_origin_proof IS NULL) OR (
    service_origin IN ('storefront', 'whatsapp') AND jsonb_typeof(service_origin_proof) = 'object'
    AND service_origin_proof->'schemaVersion' = '1'::jsonb
    AND service_origin_proof->>'merchantId' = merchant_id AND service_origin_proof->>'sessionId' = session_id
    AND length(service_origin_proof->>'globalUserId') > 0
    AND service_origin_proof - ARRAY['schemaVersion','merchantId','sessionId','globalUserId','authority','conversationId'] = '{}'::jsonb
    AND ((service_origin = 'storefront' AND service_origin_proof->>'authority' = 'storefront_entrypoint'
      AND NOT service_origin_proof ? 'conversationId')
      OR (service_origin = 'whatsapp' AND (service_origin_proof->>'authority' = 'canonical_whatsapp_entrypoint'
        OR (service_origin_proof->>'authority' = 'durable_whatsapp_buyer' AND length(service_origin_proof->>'conversationId') > 0))))
  ) IS TRUE
);
CREATE FUNCTION preserve_service_checkout_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.service_origin_proof IS NOT NULL AND NEW.service_origin_proof->>'globalUserId' IS DISTINCT FROM NEW.global_user_id THEN
      RAISE EXCEPTION 'service_checkout_origin_binding_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.service_origin IS DISTINCT FROM NEW.service_origin OR OLD.service_origin_proof IS DISTINCT FROM NEW.service_origin_proof THEN
    RAISE EXCEPTION 'service_checkout_origin_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER service_checkout_origin_immutable BEFORE INSERT OR UPDATE ON checkout_sessions
FOR EACH ROW EXECUTE FUNCTION preserve_service_checkout_origin();

-- This receipt is private adoption authority, independent of the payer identity.
-- Its marker survives later appointment and financial status changes.
ALTER TABLE appointment_audits ADD CONSTRAINT service_manual_payment_receipt_shape CHECK (
  NOT COALESCE("after" ? 'privatePaymentContinuation', false) OR (
    jsonb_typeof("after"->'privatePaymentContinuation') = 'object'
    AND "after"->'privatePaymentContinuation'->'schemaVersion' = '1'::jsonb
    AND action = 'manual_payment_prepare'
    AND "after"->'privatePaymentContinuation'->>'merchantId' = merchant_id
    AND "after"->'privatePaymentContinuation'->>'appointmentId' = appointment_id
    AND "after"->'privatePaymentContinuation'->>'appointmentVersion' = version::text
    AND "after"->'privatePaymentContinuation'->>'operatorId' = actor_id
    AND length("after"->'privatePaymentContinuation'->>'paymentIntentId') > 0
    AND length("after"->'privatePaymentContinuation'->>'unitId') > 0
    AND length("after"->'privatePaymentContinuation'->>'paymentRecordId') > 0
    AND length("after"->'privatePaymentContinuation'->>'sessionId') > 0
    AND "after"->'privatePaymentContinuation'->>'requestFingerprint' ~ '^[a-f0-9]{64}$'
    AND "after"->'privatePaymentContinuation'->>'admissionFingerprint' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("after"->'privatePaymentContinuation'->'selection') = 'object'
  ) IS TRUE
);
CREATE UNIQUE INDEX service_manual_payment_unit_receipt ON appointment_audits
  (merchant_id, (("after"->'privatePaymentContinuation'->>'paymentIntentId')), (("after"->'privatePaymentContinuation'->>'unitId')))
  WHERE "after" ? 'privatePaymentContinuation';
CREATE FUNCTION preserve_service_manual_payment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."after" ? 'privatePaymentContinuation' OR OLD.action = 'manual_payment_approved')
    AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'service_manual_payment_receipt_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER service_manual_payment_receipt_immutable BEFORE UPDATE ON appointment_audits
FOR EACH ROW EXECUTE FUNCTION preserve_service_manual_payment_receipt();
