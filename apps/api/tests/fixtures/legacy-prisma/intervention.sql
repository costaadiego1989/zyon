-- Disposable synthetic projection only; not a migration or production proof.
CREATE TABLE checkout_interventions (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  occurred_at TIMESTAMP(3) NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX checkout_interventions_merchant_id_session_id_occurred_at_idx
  ON checkout_interventions (merchant_id, session_id, occurred_at);
