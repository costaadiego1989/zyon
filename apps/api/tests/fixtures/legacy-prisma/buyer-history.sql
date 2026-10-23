-- Disposable synthetic projection of BuyerPurchaseRecord; no customer data.
CREATE TABLE buyer_purchase_records (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  global_user_id TEXT,
  merchant_customer_id TEXT,
  currency TEXT NOT NULL,
  total_amount DECIMAL(12,4) NOT NULL,
  discount_amount DECIMAL(12,4) NOT NULL,
  completed_at TIMESTAMP(3) NOT NULL,
  items JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (merchant_id, order_id)
);
CREATE INDEX buyer_purchase_records_merchant_id_global_user_id_idx ON buyer_purchase_records (merchant_id, global_user_id);
CREATE INDEX buyer_purchase_records_merchant_id_merchant_customer_id_idx ON buyer_purchase_records (merchant_id, merchant_customer_id);
CREATE INDEX buyer_purchase_records_merchant_id_global_user_id_completed_at_idx ON buyer_purchase_records (merchant_id, global_user_id, completed_at);
CREATE INDEX buyer_purchase_records_merchant_id_merchant_customer_id_completed_at_idx ON buyer_purchase_records (merchant_id, merchant_customer_id, completed_at);
CREATE INDEX buyer_purchase_records_merchant_id_completed_at_idx ON buyer_purchase_records (merchant_id, completed_at);
