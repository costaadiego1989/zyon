-- CreateTable "recovery_attempts"
CREATE TABLE "recovery_attempts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "abandonment_reason" TEXT NOT NULL,
    "abandonment_score" DOUBLE PRECISION NOT NULL,
    "strategy_json" JSONB NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_session',
    "sent_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recovered_at" TIMESTAMP(3),
    "recovered_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_attempts_merchant_id_status_idx" ON "recovery_attempts"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "recovery_attempts_merchant_id_created_at_idx" ON "recovery_attempts"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "recovery_attempts_session_id_idx" ON "recovery_attempts"("session_id");

-- CreateTable "buyer_intent_memory_consents"
CREATE TABLE "buyer_intent_memory_consents" (
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "opted_in" BOOLEAN NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_intent_memory_consents_pkey" PRIMARY KEY ("merchant_id","global_user_id")
);

-- CreateTable "customer_intent_records"
CREATE TABLE "customer_intent_records" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "primary_intent" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "budget_tier" TEXT NOT NULL,
    "category_focus" TEXT[],
    "pain_points" TEXT[],
    "conversion_likelihood_pct" INTEGER NOT NULL,
    "behavioral_signals_json" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_intent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_intent_records_merchant_id_global_user_id_idx" ON "customer_intent_records"("merchant_id", "global_user_id");

-- CreateIndex
CREATE INDEX "customer_intent_records_merchant_id_generated_at_idx" ON "customer_intent_records"("merchant_id", "generated_at");

-- CreateTable "holdout_group_assignments"
CREATE TABLE "holdout_group_assignments" (
    "global_user_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holdout_group_assignments_pkey" PRIMARY KEY ("global_user_id","merchant_id")
);

-- CreateIndex
CREATE INDEX "holdout_group_assignments_merchant_id_cohort_idx" ON "holdout_group_assignments"("merchant_id", "cohort");

-- CreateTable "attribution_tags"
CREATE TABLE "attribution_tags" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "negotiation_applied" BOOLEAN NOT NULL DEFAULT false,
    "cross_sell_applied" BOOLEAN NOT NULL DEFAULT false,
    "progressive_discount_applied" BOOLEAN NOT NULL DEFAULT false,
    "cart_recovery_applied" BOOLEAN NOT NULL DEFAULT false,
    "intent_personalization_applied" BOOLEAN NOT NULL DEFAULT false,
    "experiment_variant_id" TEXT,
    "order_value_cents" INTEGER NOT NULL,
    "discount_given_cents" INTEGER NOT NULL DEFAULT 0,
    "shipping_subsidy_cents" INTEGER NOT NULL DEFAULT 0,
    "ai_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attribution_tags_merchant_id_order_id_key" ON "attribution_tags"("merchant_id", "order_id");

-- CreateIndex
CREATE INDEX "attribution_tags_merchant_id_cohort_created_at_idx" ON "attribution_tags"("merchant_id", "cohort", "created_at");

-- CreateTable "revenue_lift_snapshots"
CREATE TABLE "revenue_lift_snapshots" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "holdout_json" JSONB NOT NULL,
    "treatment_json" JSONB NOT NULL,
    "lift_json" JSONB NOT NULL,
    "breakout_json" JSONB NOT NULL,
    "confidence_json" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_lift_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "revenue_lift_snapshots_merchant_id_calculated_at_idx" ON "revenue_lift_snapshots"("merchant_id", "calculated_at");

-- CreateTable "negotiation_attempts"
CREATE TABLE "negotiation_attempts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "cart_fingerprint" TEXT NOT NULL,
    "negotiation_result_json" JSONB NOT NULL,
    "authorized_offer_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "negotiation_attempts_merchant_id_session_id_idx" ON "negotiation_attempts"("merchant_id", "session_id");

-- CreateIndex
CREATE INDEX "negotiation_attempts_cart_fingerprint_created_at_idx" ON "negotiation_attempts"("cart_fingerprint", "created_at");
