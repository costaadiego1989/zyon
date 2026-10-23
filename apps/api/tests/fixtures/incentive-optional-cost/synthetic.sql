-- Owned disposable projection only, not the full production schema or ledger.
-- Parent projections contain only columns read by the ORIGINAL assignment guard.
CREATE TABLE merchants (id TEXT PRIMARY KEY);
CREATE TABLE strategy_incentive_budgets (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, closed_at TIMESTAMP(3));
CREATE TABLE strategy_incentive_executions (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, strategy_id TEXT NOT NULL, version INTEGER NOT NULL,
  budget_id TEXT NOT NULL, started_at TIMESTAMP(3) NOT NULL, ends_at TIMESTAMP(3) NOT NULL, UNIQUE(id,merchant_id)
);
CREATE TABLE checkout_sessions (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL, global_user_id TEXT NOT NULL,
  cohort TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL, UNIQUE(merchant_id,session_id)
);
CREATE TABLE strategy_incentive_reservations (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, budget_id TEXT NOT NULL, session_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL
);
CREATE TABLE strategy_assignments (merchant_id TEXT, session_id TEXT);
CREATE TABLE payment_intents (merchant_id TEXT, session_id TEXT);
CREATE TABLE completed_orders (merchant_id TEXT, session_id TEXT);
CREATE TABLE strategy_incentive_review_heads (
  merchant_id TEXT, strategy_id TEXT, version INTEGER, current_sequence INTEGER
);

-- Exact 11-field assignment DDL from the historical migration; parent checks
-- equality before connecting, and appends its exact historical guard function.
CREATE TABLE strategy_incentive_assignments (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, execution_id TEXT NOT NULL, session_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL, arm TEXT NOT NULL CHECK (arm IN ('control','treatment')),
  assigned_at TIMESTAMP(3) NOT NULL, cart_hash TEXT NOT NULL CHECK (cart_hash ~ '^[a-f0-9]{64}$'),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
  reservation_id TEXT UNIQUE,
  UNIQUE(merchant_id,session_id), UNIQUE(execution_id,merchant_id,buyer_id), UNIQUE(id,merchant_id),
  FOREIGN KEY(execution_id,merchant_id) REFERENCES strategy_incentive_executions(id,merchant_id) ON DELETE RESTRICT,
  FOREIGN KEY(merchant_id,session_id) REFERENCES checkout_sessions(merchant_id,session_id) ON DELETE RESTRICT,
  FOREIGN KEY(reservation_id) REFERENCES strategy_incentive_reservations(id) ON DELETE RESTRICT,
  CHECK ((arm='control' AND amount_cents=0 AND reservation_id IS NULL) OR (arm='treatment' AND amount_cents>0 AND reservation_id IS NOT NULL))
);
CREATE INDEX strategy_incentive_assignments_execution_id_merchant_id_arm_idx ON strategy_incentive_assignments(execution_id,merchant_id,arm);
