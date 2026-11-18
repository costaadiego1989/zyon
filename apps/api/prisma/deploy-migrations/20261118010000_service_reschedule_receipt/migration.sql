-- Historical source cleanup requires the complete before/after receipt.
-- Preserve original admission action rewrites and the existing cancellation guard.
CREATE OR REPLACE FUNCTION preserve_service_appointment_lease_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.action = 'reschedule' AND OLD."after" ? 'privateLease' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'service_reschedule_receipt_immutable' USING ERRCODE = '23514';
  END IF;
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
