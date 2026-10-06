-- Preserve what was purchased even when the catalog changes before approval.
ALTER TABLE "payment_intents" ADD COLUMN "digital_content" JSONB;
