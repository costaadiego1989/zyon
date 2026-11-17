-- Internal preparation and purpose-specific administrative notices.
-- No consent backfill, provider dispatch or legacy delivery/notification update.
CREATE TABLE "meta_ads_campaign_preparations" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "intent_digest" TEXT NOT NULL,
  "campaign_digest" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "requested_images" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "generation_id" TEXT,
  "proposal_id" TEXT,
  "checkpoint" JSONB NOT NULL DEFAULT '{}',
  "missing" JSONB NOT NULL DEFAULT '[]',
  "error" TEXT,
  "fence" INTEGER NOT NULL DEFAULT 0,
  "lease_token" TEXT,
  "lease_until" TIMESTAMPTZ(3),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_ads_campaign_preparations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "meta_ads_campaign_preparations_state_check" CHECK ("status" IN ('queued','preparing','creative_pending','review_ready','blocked','unknown','superseded')),
  CONSTRAINT "meta_ads_campaign_preparations_bounds_check" CHECK ("requested_images" BETWEEN 1 AND 10 AND "fence" >= 0)
);
CREATE UNIQUE INDEX "meta_ads_campaign_preparations_intent_key" ON "meta_ads_campaign_preparations"("merchant_id","campaign_id","intent_digest");
CREATE INDEX "meta_ads_campaign_preparations_pending_idx" ON "meta_ads_campaign_preparations"("status","next_attempt_at","lease_until");

CREATE TABLE "meta_ads_campaign_notice_contacts" (
  "merchant_id" TEXT PRIMARY KEY,
  "phone_number" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "consent_version" TEXT,
  "consented_by" TEXT,
  "consented_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_ads_campaign_notice_contacts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "meta_ads_campaign_notice_contacts_bounds_check" CHECK ("version" >= 0 AND ("phone_number" IS NULL OR "phone_number" ~ '^\+[1-9][0-9]{7,14}$')),
  CONSTRAINT "meta_ads_campaign_notice_contacts_consent_check" CHECK (
    ("consented_at" IS NULL AND "consented_by" IS NULL AND "consent_version" IS NULL) OR
    ("consented_at" IS NOT NULL AND "consented_by" IS NOT NULL AND "consent_version" IS NOT NULL AND "phone_number" IS NOT NULL)
  )
);

CREATE TABLE "meta_ads_campaign_ready_notices" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "proposal_digest" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "review_state" TEXT NOT NULL DEFAULT 'awaiting_approval',
  "whatsapp_status" TEXT NOT NULL DEFAULT 'queued',
  "inbox_created_at" TIMESTAMPTZ(3),
  "dispatch_snapshot" JSONB,
  "dispatch_started_at" TIMESTAMPTZ(3),
  "error" TEXT,
  "fence" INTEGER NOT NULL DEFAULT 0,
  "lease_token" TEXT,
  "lease_until" TIMESTAMPTZ(3),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_ads_campaign_ready_notices_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "meta_ads_campaign_ready_notices_state_check" CHECK (
    "review_state" IN ('awaiting_approval','approved','superseded') AND
    "whatsapp_status" IN ('queued','blocked','sending','accepted','delivered','failed','unknown') AND "fence" >= 0
  ),
  CONSTRAINT "meta_ads_campaign_ready_notices_dispatch_check" CHECK ("dispatch_started_at" IS NULL OR "dispatch_snapshot" IS NOT NULL)
);
CREATE UNIQUE INDEX "meta_ads_campaign_ready_notices_scope_key" ON "meta_ads_campaign_ready_notices"("id","merchant_id");
CREATE UNIQUE INDEX "meta_ads_campaign_ready_notices_review_key" ON "meta_ads_campaign_ready_notices"("merchant_id","proposal_id","proposal_digest");
CREATE UNIQUE INDEX "meta_ads_campaign_ready_notices_notification_id_key" ON "meta_ads_campaign_ready_notices"("notification_id");
CREATE INDEX "meta_ads_campaign_ready_notices_pending_idx" ON "meta_ads_campaign_ready_notices"("whatsapp_status","next_attempt_at","lease_until");

-- Nullable composite FKs scope only this purpose, preserving all legacy rows.
ALTER TABLE "whatsapp_deliveries" ADD COLUMN "campaign_ready_notice_id" TEXT;
CREATE UNIQUE INDEX "whatsapp_deliveries_campaign_notice_key" ON "whatsapp_deliveries"("campaign_ready_notice_id","merchant_id");
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_campaign_notice_scope_fkey"
  FOREIGN KEY ("campaign_ready_notice_id","merchant_id") REFERENCES "meta_ads_campaign_ready_notices"("id","merchant_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merchant_notifications" ADD COLUMN "campaign_ready_notice_id" TEXT;
CREATE UNIQUE INDEX "merchant_notifications_campaign_notice_key" ON "merchant_notifications"("campaign_ready_notice_id","merchant_id");
ALTER TABLE "merchant_notifications" ADD CONSTRAINT "merchant_notifications_campaign_notice_scope_fkey"
  FOREIGN KEY ("campaign_ready_notice_id","merchant_id") REFERENCES "meta_ads_campaign_ready_notices"("id","merchant_id") ON DELETE CASCADE ON UPDATE CASCADE;
