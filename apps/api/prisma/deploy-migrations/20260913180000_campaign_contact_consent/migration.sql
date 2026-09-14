-- Explicit authorization for commercial campaigns, scoped to merchant, buyer,
-- channel and purpose. Existing contacts are deliberately not backfilled.
CREATE TABLE "campaign_contact_consents" (
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'granted',
    "policy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "granted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaign_contact_consents_pkey" PRIMARY KEY ("merchant_id", "global_user_id", "channel", "purpose")
);

CREATE INDEX "campaign_contact_consents_merchant_id_global_user_id_status_idx"
ON "campaign_contact_consents"("merchant_id", "global_user_id", "status");

ALTER TABLE "campaign_contact_consents"
ADD CONSTRAINT "campaign_contact_consents_merchant_id_fkey"
FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaign_contact_consents"
ADD CONSTRAINT "campaign_contact_consents_global_user_id_fkey"
FOREIGN KEY ("global_user_id") REFERENCES "buyer_accounts"("global_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
