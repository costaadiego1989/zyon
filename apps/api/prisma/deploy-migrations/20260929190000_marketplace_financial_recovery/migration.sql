-- Financial history requires reconciliation, never automatic duplicate deletion.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM marketplace_seller_debts GROUP BY settlement_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'marketplace_duplicate_debts_require_reconciliation';
  END IF;
END $$;
CREATE UNIQUE INDEX "marketplace_seller_debts_settlement_id_key" ON "marketplace_seller_debts"("settlement_id");
ALTER TABLE "cross_store_line_items" ADD COLUMN "terms_json" JSONB, ADD COLUMN "purchased_at" TIMESTAMP(3);
CREATE TABLE "marketplace_order_ledgers" (
  "host_merchant_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "checkout_session_id" TEXT,
  "purchased_at" TIMESTAMP(3),
  "chargeback_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("host_merchant_id", "order_id")
);
-- Recover paid dates only from matching persisted orders. Legacy terms remain
-- NULL intentionally: today's settings cannot establish what was agreed then.
UPDATE cross_store_line_items item SET purchased_at = orders.completed_at
FROM completed_orders orders
WHERE item.host_merchant_id = orders.merchant_id AND item.order_id = orders.external_order_id
  AND item.checkout_session_id = orders.session_id;
