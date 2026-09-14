CREATE TABLE "merchant_order_quota_periods" (
    "merchant_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "used_orders" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchant_order_quota_periods_pkey" PRIMARY KEY ("merchant_id", "period_start")
);

CREATE TABLE "merchant_order_quota_entries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "external_order_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merchant_order_quota_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "merchant_order_quota_episodes" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "plan_key" TEXT NOT NULL,
    "limit_at_start" INTEGER NOT NULL,
    "reached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grace_expires_at" TIMESTAMP(3) NOT NULL,
    "blocked_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolution_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchant_order_quota_episodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "merchant_order_quota_notices" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "episode_key" TEXT NOT NULL,
    "milestone" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merchant_order_quota_notices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "merchant_order_quota_deliveries" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchant_order_quota_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merchant_order_quota_entries_merchant_id_external_order_id_key"
  ON "merchant_order_quota_entries"("merchant_id", "external_order_id");
CREATE INDEX "merchant_order_quota_entries_merchant_id_period_start_idx"
  ON "merchant_order_quota_entries"("merchant_id", "period_start");
CREATE INDEX "merchant_order_quota_periods_period_start_period_end_idx"
  ON "merchant_order_quota_periods"("period_start", "period_end");
CREATE UNIQUE INDEX "merchant_order_quota_episodes_merchant_id_period_start_plan_key_limit_at_start_key"
  ON "merchant_order_quota_episodes"("merchant_id", "period_start", "plan_key", "limit_at_start");
CREATE INDEX "merchant_order_quota_episodes_merchant_id_period_start_resolved_at_idx"
  ON "merchant_order_quota_episodes"("merchant_id", "period_start", "resolved_at");
CREATE INDEX "merchant_order_quota_episodes_grace_expires_at_resolved_at_idx"
  ON "merchant_order_quota_episodes"("grace_expires_at", "resolved_at");
CREATE UNIQUE INDEX "merchant_order_quota_notices_merchant_id_period_start_episode_key_milestone_key"
  ON "merchant_order_quota_notices"("merchant_id", "period_start", "episode_key", "milestone");
CREATE INDEX "merchant_order_quota_notices_merchant_id_created_at_idx"
  ON "merchant_order_quota_notices"("merchant_id", "created_at");
CREATE UNIQUE INDEX "merchant_order_quota_deliveries_notice_id_channel_key"
  ON "merchant_order_quota_deliveries"("notice_id", "channel");
CREATE INDEX "merchant_order_quota_deliveries_status_next_attempt_at_idx"
  ON "merchant_order_quota_deliveries"("status", "next_attempt_at");

ALTER TABLE "merchant_order_quota_periods"
  ADD CONSTRAINT "merchant_order_quota_periods_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_order_quota_entries"
  ADD CONSTRAINT "merchant_order_quota_entries_merchant_id_period_start_fkey"
  FOREIGN KEY ("merchant_id", "period_start") REFERENCES "merchant_order_quota_periods"("merchant_id", "period_start") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_order_quota_entries"
  ADD CONSTRAINT "merchant_order_quota_entries_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_order_quota_episodes"
  ADD CONSTRAINT "merchant_order_quota_episodes_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_order_quota_notices"
  ADD CONSTRAINT "merchant_order_quota_notices_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_order_quota_notices"
  ADD CONSTRAINT "merchant_order_quota_notices_episode_key_fkey"
  FOREIGN KEY ("episode_key") REFERENCES "merchant_order_quota_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_order_quota_deliveries"
  ADD CONSTRAINT "merchant_order_quota_deliveries_notice_id_fkey"
  FOREIGN KEY ("notice_id") REFERENCES "merchant_order_quota_notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
