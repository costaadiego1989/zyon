-- Keeps the bounded buyer-context queries index-backed for both supported
-- buyer identity forms. IF NOT EXISTS makes the deploy delta safe for
-- environments whose schema was created from the consolidated baseline.
CREATE INDEX IF NOT EXISTS "buyer_purchase_records_merchant_id_global_user_id_completed_at_idx"
  ON "buyer_purchase_records"("merchant_id", "global_user_id", "completed_at");

CREATE INDEX IF NOT EXISTS "buyer_purchase_records_merchant_id_merchant_customer_id_completed_at_idx"
  ON "buyer_purchase_records"("merchant_id", "merchant_customer_id", "completed_at");
