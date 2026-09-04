-- A/B Testing: Prompt Experiments data layer

-- PromptExperiment
CREATE TABLE "prompt_experiments" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "winner_variant_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_experiments_pkey" PRIMARY KEY ("id")
);

-- PromptVariant
CREATE TABLE "prompt_variants" (
    "id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "is_control" BOOLEAN NOT NULL DEFAULT false,
    "system_prompt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_variants_pkey" PRIMARY KEY ("id")
);

-- PromptVariantResult
CREATE TABLE "prompt_variant_results" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "converted" BOOLEAN NOT NULL,
    "revenue" DECIMAL(12,4),
    "offers_shown" INTEGER NOT NULL DEFAULT 0,
    "offers_accepted" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_variant_results_pkey" PRIMARY KEY ("id")
);

-- CheckoutSession: add prompt_variant_id column
ALTER TABLE "checkout_sessions" ADD COLUMN "prompt_variant_id" TEXT;

-- Unique constraints
CREATE UNIQUE INDEX "prompt_experiments_merchant_id_name_key" ON "prompt_experiments"("merchant_id", "name");
CREATE UNIQUE INDEX "prompt_variants_experiment_id_name_key" ON "prompt_variants"("experiment_id", "name");
CREATE UNIQUE INDEX "prompt_variant_results_variant_id_session_id_key" ON "prompt_variant_results"("variant_id", "session_id");

-- Indexes
CREATE INDEX "prompt_experiments_merchant_id_status_idx" ON "prompt_experiments"("merchant_id", "status");
CREATE INDEX "prompt_experiments_merchant_id_created_at_idx" ON "prompt_experiments"("merchant_id", "created_at");
CREATE INDEX "prompt_variants_experiment_id_idx" ON "prompt_variants"("experiment_id");
CREATE INDEX "prompt_variant_results_variant_id_created_at_idx" ON "prompt_variant_results"("variant_id", "created_at");

-- Foreign keys
ALTER TABLE "prompt_variants" ADD CONSTRAINT "prompt_variants_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "prompt_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prompt_variant_results" ADD CONSTRAINT "prompt_variant_results_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "prompt_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
