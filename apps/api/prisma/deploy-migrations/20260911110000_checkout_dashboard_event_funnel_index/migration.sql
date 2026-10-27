CREATE INDEX IF NOT EXISTS "checkout_events_merchant_id_event_name_occurred_at_session_id_idx"
  ON "checkout_events"("merchant_id", "event_name", "occurred_at", "session_id");
