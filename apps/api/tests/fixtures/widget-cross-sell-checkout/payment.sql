-- Owned synthetic supplement, NOT a migration. Only the real presence-only
-- marketplace safety lookup is exercised; this does not prove marketplace IO.
CREATE TABLE cross_store_line_items (
  id TEXT PRIMARY KEY, host_merchant_id TEXT NOT NULL, checkout_session_id TEXT NOT NULL
);
-- Deterministic database-side failure AFTER the journal/order writes so native
-- cases can prove transaction rollback, not an in-memory simulation.
ALTER TABLE outbox_messages ADD CONSTRAINT synthetic_widget_payment_rollback
  CHECK (event_type <> 'synthetic.payment.rollback');
ALTER TABLE outbox_messages ADD CONSTRAINT synthetic_widget_order_rollback
  CHECK (NOT (event_type='order.confirmed' AND payload->>'orderId'='synthetic-provider-rollback'));
