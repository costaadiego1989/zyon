-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider_event_id" TEXT,
    "merchant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "execution_status" TEXT NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "cost_micros" BIGINT,
    "currency" TEXT,
    "pricing_version" TEXT,
    "cost_status" TEXT NOT NULL DEFAULT 'unpriced',
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "conversation_id" TEXT,
    "voice_session_id" TEXT,
    "correlation_id" TEXT,
    "parent_usage_event_id" TEXT,
    "metadata" JSONB,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_price_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "input_micros_per_million" BIGINT,
    "output_micros_per_million" BIGINT,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_price_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_analysis_schedules" (
    "merchant_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "group" INTEGER NOT NULL,
    "next_due_at" TIMESTAMP(3) NOT NULL,
    "last_successful_at" TIMESTAMP(3),
    "current_run_id" TEXT,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "migrated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_analysis_schedules_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "revenue_analysis_runs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" TEXT,
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMP(3),
    "retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "as_of" TIMESTAMP(3),
    "observation_id" TEXT,
    "hypothesis_id" TEXT,
    "generated_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "revenue_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_ai_reservations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "work_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price_version" TEXT NOT NULL,
    "input_rate" BIGINT NOT NULL,
    "output_rate" BIGINT NOT NULL,
    "max_input_tokens" INTEGER NOT NULL,
    "max_output_tokens" INTEGER NOT NULL,
    "amount_micros" BIGINT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'dispatched',
    "usage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "revenue_ai_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_events_idempotency_key_key" ON "ai_usage_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_usage_events_merchant_id_started_at_idx" ON "ai_usage_events"("merchant_id", "started_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_merchant_id_channel_started_at_idx" ON "ai_usage_events"("merchant_id", "channel", "started_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_provider_provider_event_id_idx" ON "ai_usage_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "ai_usage_events_conversation_id_started_at_idx" ON "ai_usage_events"("conversation_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_price_versions_version_key" ON "ai_price_versions"("version");

-- CreateIndex
CREATE INDEX "ai_price_versions_provider_model_channel_component_effectiv_idx" ON "ai_price_versions"("provider", "model", "channel", "component", "effective_from");

-- CreateIndex
CREATE INDEX "revenue_analysis_schedules_next_due_at_merchant_id_idx" ON "revenue_analysis_schedules"("next_due_at", "merchant_id");

-- CreateIndex
CREATE INDEX "revenue_analysis_runs_status_retry_at_created_at_idx" ON "revenue_analysis_runs"("status", "retry_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_analysis_runs_merchant_id_cycle_key" ON "revenue_analysis_runs"("merchant_id", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_ai_reservations_usage_key_key" ON "revenue_ai_reservations"("usage_key");

-- CreateIndex
CREATE INDEX "revenue_ai_reservations_currency_created_at_idx" ON "revenue_ai_reservations"("currency", "created_at");

-- CreateIndex
CREATE INDEX "revenue_ai_reservations_run_id_idx" ON "revenue_ai_reservations"("run_id");

-- CreateIndex
CREATE INDEX "revenue_ai_reservations_provider_model_state_created_at_idx" ON "revenue_ai_reservations"("provider", "model", "state", "created_at");
