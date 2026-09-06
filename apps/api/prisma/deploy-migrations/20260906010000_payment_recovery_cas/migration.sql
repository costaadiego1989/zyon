ALTER TABLE "payment_intents"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "amount_breakdown" JSONB,
  ADD COLUMN "creation" JSONB;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_version_nonnegative" CHECK ("version" >= 0);
