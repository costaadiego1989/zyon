ALTER TABLE "cross_store_line_items" ADD COLUMN "source_variant_id" TEXT,
  ADD COLUMN "stock_reservation_id" TEXT;
CREATE UNIQUE INDEX "cross_store_line_items_stock_reservation_id_key" ON "cross_store_line_items"("stock_reservation_id");
CREATE INDEX "cross_store_line_items_host_merchant_id_checkout_session_id_idx" ON "cross_store_line_items"("host_merchant_id", "checkout_session_id");
