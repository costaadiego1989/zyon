-- Private original receipts live on audits, never raw public appointments.
ALTER TABLE "appointment_audits" ADD CONSTRAINT "appointment_audit_private_lease_shape" CHECK (
  NOT (COALESCE("after", '{}'::jsonb) ? 'privateLease') OR (
    jsonb_typeof("after"->'privateLease') = 'object'
    AND "after"->'privateLease'->>'schemaVersion' = '1'
    AND "after"->'privateLease'->>'targetKey' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("after"->'privateLease'->'target') = 'object'
    AND (
      ("after"->'privateLease'->>'kind' = 'none'
        AND "after"->'privateLease'->>'reason' IN ('hold_off', 'pending_without_lease'))
      OR ("after"->'privateLease'->>'kind' = 'owned'
        AND "after"->'privateLease'->>'merchantId' = "merchant_id"
        AND "after"->'privateLease'->>'generation' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
        AND "after"->'privateLease'->>'ownerHash' ~ '^[a-f0-9]{64}$'
        AND "after"->'privateLease'->>'fingerprint' ~ '^[a-f0-9]{64}$'
        AND jsonb_typeof("after"->'privateLease'->'resources') = 'array'
        AND jsonb_array_length("after"->'privateLease'->'resources') > 0)
    )
  ) IS TRUE
);

-- The marker survives admit -> manual_create/checkout_confirm rewrites. A live
-- old generation cannot bind another appointment before delayed cleanup runs.
CREATE UNIQUE INDEX "appointment_audits_owned_lease_target_key"
  ON "appointment_audits" ("merchant_id",
    ("after"->'privateLease'->>'generation'), ("after"->'privateLease'->>'targetKey'))
  WHERE "after"->'privateLease'->>'kind' = 'owned';

CREATE FUNCTION preserve_service_appointment_lease_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."after"->'privateLease') IS DISTINCT FROM (NEW."after"->'privateLease') THEN
    RAISE EXCEPTION 'service_hold_capture_immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."after" ? 'privateLease' AND
    (OLD.id IS DISTINCT FROM NEW.id OR OLD.merchant_id IS DISTINCT FROM NEW.merchant_id
      OR OLD.appointment_id IS DISTINCT FROM NEW.appointment_id OR OLD.version IS DISTINCT FROM NEW.version
      OR OLD.command_id IS DISTINCT FROM NEW.command_id OR OLD.actor_id IS DISTINCT FROM NEW.actor_id
      OR OLD.origin IS DISTINCT FROM NEW.origin OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at) THEN
    RAISE EXCEPTION 'service_hold_capture_immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."after" ? 'privateLeaseCleanup' AND
    (OLD.id IS DISTINCT FROM NEW.id OR OLD.merchant_id IS DISTINCT FROM NEW.merchant_id
      OR OLD.appointment_id IS DISTINCT FROM NEW.appointment_id OR OLD.version IS DISTINCT FROM NEW.version
      OR OLD.command_id IS DISTINCT FROM NEW.command_id OR OLD.action IS DISTINCT FROM NEW.action
      OR OLD."after" IS DISTINCT FROM NEW."after") THEN
    RAISE EXCEPTION 'service_hold_cancel_receipt_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_service_appointment_lease_receipt
  BEFORE UPDATE ON "appointment_audits" FOR EACH ROW
  EXECUTE FUNCTION preserve_service_appointment_lease_receipt();
