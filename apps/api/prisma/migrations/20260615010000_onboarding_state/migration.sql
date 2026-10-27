-- Self-serve tenant onboarding progress (ADR 0015/0024).
-- Resumable provisioning state persisted per merchant.

CREATE TABLE "merchant_onboarding_states" (
  "merchant_id" TEXT NOT NULL,
  "steps" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "merchant_onboarding_states_pkey" PRIMARY KEY ("merchant_id")
);

ALTER TABLE "merchant_onboarding_states"
  ADD CONSTRAINT "merchant_onboarding_states_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
