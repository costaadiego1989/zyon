CREATE TABLE cashback_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('cashback_available','cashback_expiring')),
  source_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('dispatching','cancelled','sent','skipped','unknown')),
  reason TEXT,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(merchant_id,type,source_id)
);
CREATE INDEX cashback_notifications_review_idx ON cashback_notifications(merchant_id,state,created_at);