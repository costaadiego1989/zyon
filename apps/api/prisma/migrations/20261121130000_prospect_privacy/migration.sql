ALTER TABLE prospect_outbox ADD COLUMN resource_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE prospect_inbox_events ADD COLUMN resource_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE TABLE prospect_retention_runs (
  id TEXT PRIMARY KEY DEFAULT 'daily', last_run_at TIMESTAMP(3) NOT NULL,
  next_run_at TIMESTAMP(3) NOT NULL, erased_count INTEGER NOT NULL DEFAULT 0
);
-- Ordinary receipt edits/deletes remain forbidden. Privacy erasure is monotonic:
-- only remove evidence after a protected suppression and endpoint erasure exist.
CREATE OR REPLACE FUNCTION prospecting_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.status='revoked' AND NEW.source='retention_erased' AND NEW.evidence_ref IS NULL AND NEW.text_version IS NULL
       AND (to_jsonb(NEW)-ARRAY['status','source','evidence_ref','text_version'])=(to_jsonb(OLD)-ARRAY['status','source','evidence_ref','text_version'])
       AND EXISTS (SELECT 1 FROM prospect_endpoints e JOIN contact_suppressions s ON s.sender_scope='zyon_platform' AND s.protected_lookup=e.protected_lookup AND s.key_version=e.key_version WHERE e.id=OLD.endpoint_id AND e.normalized_value IS NULL)
    THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'prospecting_receipt_append_only' USING ERRCODE='23514';
END;
$$;
