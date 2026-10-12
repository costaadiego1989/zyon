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

CREATE UNIQUE INDEX "ai_usage_events_idempotency_key_key"
  ON "ai_usage_events"("idempotency_key");
CREATE INDEX "ai_usage_events_merchant_id_started_at_idx"
  ON "ai_usage_events"("merchant_id", "started_at");
CREATE INDEX "ai_usage_events_merchant_id_channel_started_at_idx"
  ON "ai_usage_events"("merchant_id", "channel", "started_at");
CREATE INDEX "ai_usage_events_provider_provider_event_id_idx"
  ON "ai_usage_events"("provider", "provider_event_id");
CREATE INDEX "ai_usage_events_conversation_id_started_at_idx"
  ON "ai_usage_events"("conversation_id", "started_at");
