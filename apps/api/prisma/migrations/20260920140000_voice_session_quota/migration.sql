CREATE TABLE "merchant_voice_session_quota_periods" (
    "merchant_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "used_sessions" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_voice_session_quota_periods_pkey" PRIMARY KEY ("merchant_id", "period_start")
);

CREATE TABLE "merchant_voice_sessions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'reserved',
    "provider_call_id" TEXT,
    "provider_created_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_voice_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merchant_voice_sessions_provider_call_id_key" ON "merchant_voice_sessions"("provider_call_id");
CREATE UNIQUE INDEX "merchant_voice_sessions_merchant_id_idempotency_key_key" ON "merchant_voice_sessions"("merchant_id", "idempotency_key");
CREATE INDEX "merchant_voice_session_quota_periods_period_start_period_end_idx" ON "merchant_voice_session_quota_periods"("period_start", "period_end");
CREATE INDEX "merchant_voice_sessions_merchant_id_period_start_state_idx" ON "merchant_voice_sessions"("merchant_id", "period_start", "state");

ALTER TABLE "merchant_voice_session_quota_periods"
  ADD CONSTRAINT "merchant_voice_session_quota_periods_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merchant_voice_sessions"
  ADD CONSTRAINT "merchant_voice_sessions_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merchant_voice_sessions"
  ADD CONSTRAINT "merchant_voice_sessions_merchant_id_period_start_fkey"
  FOREIGN KEY ("merchant_id", "period_start")
  REFERENCES "merchant_voice_session_quota_periods"("merchant_id", "period_start") ON DELETE CASCADE ON UPDATE CASCADE;
