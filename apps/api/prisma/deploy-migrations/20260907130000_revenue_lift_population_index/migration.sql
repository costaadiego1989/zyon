CREATE INDEX IF NOT EXISTS "idx_checkout_sessions_merchant_cohort_created_at"
  ON "checkout_sessions" ("merchant_id", "cohort", "created_at");
