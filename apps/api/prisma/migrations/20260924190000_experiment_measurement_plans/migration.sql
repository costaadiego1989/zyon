CREATE UNIQUE INDEX "prompt_experiments_id_merchant_id_key" ON "prompt_experiments"("id", "merchant_id");

CREATE TABLE "experiment_measurement_plans" (
  "experiment_id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "plan_hash" TEXT NOT NULL,
  "plan" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "experiment_measurement_plans_experiment_id_merchant_id_fkey"
    FOREIGN KEY ("experiment_id", "merchant_id") REFERENCES "prompt_experiments"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "experiment_measurement_plans_experiment_id_merchant_id_key" ON "experiment_measurement_plans"("experiment_id", "merchant_id");
CREATE INDEX "experiment_measurement_plans_merchant_id_created_at_idx" ON "experiment_measurement_plans"("merchant_id", "created_at");

CREATE TABLE "experiment_measurement_reviews" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experiment_id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "plan_hash" TEXT NOT NULL,
  "evidence_hash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "experiment_measurement_reviews_experiment_id_merchant_id_fkey"
    FOREIGN KEY ("experiment_id", "merchant_id") REFERENCES "experiment_measurement_plans"("experiment_id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "experiment_measurement_reviews_request_key" ON "experiment_measurement_reviews"("merchant_id", "experiment_id", "request_key");
CREATE INDEX "experiment_measurement_reviews_collected_at_idx" ON "experiment_measurement_reviews"("merchant_id", "experiment_id", "collected_at");

-- Keep the original decision evidence even when later order state changes.
CREATE FUNCTION reject_experiment_measurement_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EXPERIMENT_MEASUREMENT_IMMUTABLE';
END;
$$;
CREATE TRIGGER experiment_measurement_plan_immutable BEFORE UPDATE OR DELETE ON experiment_measurement_plans
  FOR EACH ROW EXECUTE FUNCTION reject_experiment_measurement_update();
CREATE TRIGGER experiment_measurement_review_immutable BEFORE UPDATE OR DELETE ON experiment_measurement_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_experiment_measurement_update();

CREATE INDEX "checkout_sessions_merchant_id_prompt_variant_id_created_at_idx"
  ON "checkout_sessions"("merchant_id", "prompt_variant_id", "created_at");
