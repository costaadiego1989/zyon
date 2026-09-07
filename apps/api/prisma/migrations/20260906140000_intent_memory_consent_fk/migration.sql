-- Intent records require a durable consent owned by the same merchant/buyer.
-- Purging existing orphans is deliberate: retained behavioural data without a
-- consent record has no verifiable processing basis.
DELETE FROM "customer_intent_records" AS record
WHERE NOT EXISTS (
  SELECT 1
  FROM "buyer_intent_memory_consents" AS consent
  WHERE consent."merchant_id" = record."merchant_id"
    AND consent."global_user_id" = record."global_user_id"
);

ALTER TABLE "customer_intent_records"
  ADD CONSTRAINT "customer_intent_records_merchant_id_global_user_id_fkey"
  FOREIGN KEY ("merchant_id", "global_user_id")
  REFERENCES "buyer_intent_memory_consents"("merchant_id", "global_user_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
