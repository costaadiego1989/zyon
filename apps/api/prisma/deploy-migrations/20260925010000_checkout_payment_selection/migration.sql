-- A selected method is not evidence of payment. Existing sessions remain
-- unknown; do not infer or backfill a method from messages or events.
ALTER TABLE checkout_sessions ADD COLUMN payment_method TEXT;
ALTER TABLE checkout_sessions ADD CONSTRAINT checkout_session_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('pix', 'credit_card', 'boleto', 'crypto'));
