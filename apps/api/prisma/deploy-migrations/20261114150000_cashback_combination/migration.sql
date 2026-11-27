-- Persist actual authorized benefit origins independently of presentation labels.
CREATE TABLE cashback_checkout_benefits (
  merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  data JSONB NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(merchant_id,session_id)
);
CREATE TABLE cashback_benefit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  data JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(merchant_id,session_id,version)
);
CREATE INDEX cashback_benefit_events_session ON cashback_benefit_events(merchant_id,session_id,occurred_at);
