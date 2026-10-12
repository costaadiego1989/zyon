-- Operational notifications only. No financial/order/stock mutation.
CREATE OR REPLACE FUNCTION marketplace_operational_dimensions_valid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(value) <> 'object' THEN false ELSE
  NOT EXISTS (SELECT 1 FROM jsonb_each(value) kv WHERE
   kv.key NOT IN ('job','worker','provider','status','event_type','party','reason','operation','cluster','environment','namespace','phase','integration','kind','scope','outcome','channel')
   OR jsonb_typeof(kv.value) <> 'string' OR (kv.value #>> '{}') !~ '^[A-Za-z0-9_.:-]{1,80}$') END
$$;

CREATE TABLE IF NOT EXISTS marketplace_operational_alerts (
 id text PRIMARY KEY CHECK (id ~ '^ops_[a-f0-9]{64}$'),
 merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 alert_name text NOT NULL CHECK (alert_name ~ '^[A-Za-z][A-Za-z0-9]{1,100}$'),
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{16}$'),
 starts_at timestamptz NOT NULL,
 state text NOT NULL CHECK (state IN ('firing','resolved')),
 severity text NOT NULL CHECK (severity IN ('warning','critical')),
 dimensions jsonb NOT NULL CHECK (marketplace_operational_dimensions_valid(dimensions)),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_operational_alerts_merchant_created
 ON marketplace_operational_alerts (merchant_id,created_at);

CREATE TABLE IF NOT EXISTS marketplace_operational_alert_deliveries (
 id text PRIMARY KEY,
 alert_id text NOT NULL REFERENCES marketplace_operational_alerts(id) ON DELETE RESTRICT,
 channel text NOT NULL CHECK (channel IN ('email','whatsapp','dashboard')),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sending','accepted','retryable_failed','failed','unknown')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 12),
 lease_token text,
 lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 provider_message_id text,
 last_error text CHECK (last_error IS NULL OR last_error ~ '^[A-Za-z0-9_.:-]{1,120}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (alert_id,channel),
 CHECK (id=alert_id || ':' || channel),
 CHECK ((status IN ('processing','sending') AND lease_token IS NOT NULL AND lease_token ~ '^[a-f0-9-]{36}$' AND lease_until IS NOT NULL)
   OR (status NOT IN ('processing','sending') AND lease_token IS NULL AND lease_until IS NULL)),
 CHECK (provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 200),
 CHECK (status<>'accepted' OR provider_message_id IS NOT NULL),
 CHECK (status NOT IN ('pending','processing','retryable_failed') OR provider_message_id IS NULL)
);
CREATE INDEX IF NOT EXISTS marketplace_operational_alert_deliveries_due
 ON marketplace_operational_alert_deliveries (status,next_attempt_at);
CREATE INDEX IF NOT EXISTS marketplace_operational_alert_deliveries_alert
 ON marketplace_operational_alert_deliveries (alert_id);

CREATE OR REPLACE FUNCTION marketplace_operational_alert_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'marketplace_operational_alert_immutable';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_operational_alert_immutable_guard ON marketplace_operational_alerts;
CREATE TRIGGER marketplace_operational_alert_immutable_guard BEFORE UPDATE OR DELETE
 ON marketplace_operational_alerts FOR EACH ROW EXECUTE FUNCTION marketplace_operational_alert_immutable();

CREATE OR REPLACE FUNCTION marketplace_operational_alert_delivery_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.provider_message_id IS NOT NULL
    OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL THEN
   RAISE EXCEPTION 'marketplace_operational_alert_delivery_initial_state_invalid';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_operational_alert_delivery_immutable'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.alert_id IS DISTINCT FROM OLD.alert_id
   OR NEW.channel IS DISTINCT FROM OLD.channel OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'marketplace_operational_alert_delivery_identity_immutable';
 END IF;
 IF OLD.status IN ('accepted','unknown','failed') AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'marketplace_operational_alert_delivery_terminal';
 END IF;
 IF NEW.status='processing' AND (OLD.status IN ('pending','retryable_failed','processing')) THEN
  IF NEW.attempts<>OLD.attempts+1 OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token THEN
   RAISE EXCEPTION 'marketplace_operational_alert_delivery_claim_invalid';
  END IF;
 ELSIF NEW.attempts<>OLD.attempts THEN
  RAISE EXCEPTION 'marketplace_operational_alert_delivery_attempts_invalid';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
  (OLD.status IN ('pending','retryable_failed') AND NEW.status='processing')
  OR (OLD.status='processing' AND NEW.status IN ('sending','accepted','retryable_failed','failed','unknown'))
  OR (OLD.status='sending' AND NEW.status IN ('accepted','retryable_failed','failed','unknown'))) THEN
  RAISE EXCEPTION 'marketplace_operational_alert_delivery_transition_invalid';
 END IF;
 IF OLD.status='processing' AND NEW.status='sending' AND
   (NEW.lease_token IS DISTINCT FROM OLD.lease_token OR NEW.lease_until IS DISTINCT FROM OLD.lease_until) THEN
  RAISE EXCEPTION 'marketplace_operational_alert_delivery_lease_invalid';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_operational_alert_delivery_guard ON marketplace_operational_alert_deliveries;
CREATE TRIGGER marketplace_operational_alert_delivery_guard BEFORE INSERT OR UPDATE OR DELETE
 ON marketplace_operational_alert_deliveries FOR EACH ROW EXECUTE FUNCTION marketplace_operational_alert_delivery_guard();
