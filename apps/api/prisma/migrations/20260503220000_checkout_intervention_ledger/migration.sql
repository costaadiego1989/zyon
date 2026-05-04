-- Checkout intervention ledger (append-only facts per checkout session)
CREATE TABLE "checkout_interventions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "checkout_interventions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "checkout_interventions_merchant_id_session_id_occurred_at_idx" ON "checkout_interventions"("merchant_id", "session_id", "occurred_at");
