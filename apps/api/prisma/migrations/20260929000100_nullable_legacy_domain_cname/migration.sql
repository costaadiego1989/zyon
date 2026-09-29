-- Existing installations can contain legacy registrations without a CNAME target.
-- Preserve all values and ownership status; application reads use the configured
-- registration target only when the persisted target is absent.
ALTER TABLE "merchant_domains" ALTER COLUMN "cname_target" DROP NOT NULL;
