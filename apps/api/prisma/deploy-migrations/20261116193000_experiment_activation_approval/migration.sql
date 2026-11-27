CREATE TABLE "experiment_activation_approvals" (
  "experiment_id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "review_hash" TEXT NOT NULL,
  "variant_fingerprint" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "actor_role" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "approved_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3),
  CONSTRAINT "experiment_activation_approvals_pkey" PRIMARY KEY ("experiment_id"),
  CONSTRAINT "experiment_activation_approvals_experiment_id_merchant_id_fkey"
    FOREIGN KEY ("experiment_id", "merchant_id") REFERENCES "prompt_experiments"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "experiment_activation_approvals_merchant_id_experiment_id_reque_key"
  ON "experiment_activation_approvals"("merchant_id", "experiment_id", "request_key");
CREATE UNIQUE INDEX "experiment_activation_approvals_experiment_id_merchant_id_key"
  ON "experiment_activation_approvals"("experiment_id", "merchant_id");
CREATE INDEX "experiment_activation_approvals_merchant_id_approved_at_idx"
  ON "experiment_activation_approvals"("merchant_id", "approved_at");
