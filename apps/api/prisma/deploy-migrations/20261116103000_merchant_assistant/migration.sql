CREATE TABLE "merchant_assistant_threads" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "actor_id" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "campaign_progress" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merchant_assistant_threads_id_scope_key" UNIQUE ("id","merchant_id"),
  CONSTRAINT "merchant_assistant_threads_actor_context_key" UNIQUE ("merchant_id","actor_id","context")
);

CREATE TABLE "merchant_assistant_turns" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "request_key" TEXT NOT NULL CHECK (length("request_key") BETWEEN 1 AND 200),
  "input_hash" TEXT NOT NULL CHECK ("input_hash" ~ '^[a-f0-9]{64}$'),
  "message" TEXT NOT NULL CHECK (length("message") BETWEEN 1 AND 8000),
  "status" TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','running','completed','failed','unknown')),
  "reply" TEXT,
  "references" JSONB NOT NULL DEFAULT '[]',
  "artifacts" JSONB NOT NULL DEFAULT '[]',
  "error" TEXT,
  "lease_token" TEXT,
  "lease_until" TIMESTAMPTZ(3),
  "budget_amount_micros" BIGINT NOT NULL DEFAULT 0 CHECK ("budget_amount_micros" >= 0),
  "budget_state" TEXT NOT NULL DEFAULT 'none' CHECK ("budget_state" IN ('none','reserved','dispatched','settled','released','unknown')),
  "usage_cost_micros" BIGINT CHECK ("usage_cost_micros" IS NULL OR "usage_cost_micros" >= 0),
  "provider_requests" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merchant_assistant_turns_thread_scope_fkey" FOREIGN KEY ("thread_id","merchant_id") REFERENCES "merchant_assistant_threads"("id","merchant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "merchant_assistant_turns_request_key" UNIQUE ("thread_id","request_key"),
  CONSTRAINT "merchant_assistant_turns_ordinal_key" UNIQUE ("thread_id","ordinal")
);
CREATE INDEX "merchant_assistant_turns_merchant_created_idx" ON "merchant_assistant_turns"("merchant_id","created_at");
CREATE INDEX "merchant_assistant_turns_pending_idx" ON "merchant_assistant_turns"("status","lease_until");

CREATE TABLE "meta_ads_daily_runs" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "account_id" TEXT NOT NULL,
  "local_day" TEXT NOT NULL CHECK ("local_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  "timezone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','running','partial','completed')),
  "analysis_status" TEXT NOT NULL DEFAULT 'pending' CHECK ("analysis_status" IN ('pending','running','completed','awaiting_data','unknown','unavailable')),
  "fence" INTEGER NOT NULL DEFAULT 0 CHECK ("fence" >= 0),
  "lease_token" TEXT,
  "lease_until" TIMESTAMPTZ(3),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "progress" JSONB NOT NULL DEFAULT '{}',
  "report" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_ads_daily_runs_day_scope_key" UNIQUE ("merchant_id","account_id","local_day","timezone")
);
CREATE INDEX "meta_ads_daily_runs_pending_idx" ON "meta_ads_daily_runs"("status","next_attempt_at");
