export interface MarketplaceConfig {
  id: string;
  merchant_id: string;
  enabled: boolean;
  commission_percent: number;
  return_window_days: number;
  settlement_window_days: number;
  chargeback_window_days: number;
  blocked_merchant_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface MarketplaceOrderLineItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  status: "pending" | "shipped" | "delivered";
  tracking_number?: string;
  shipped_at?: string;
  delivered_at?: string;
}

export interface MarketplaceOrder {
  id: string;
  seller_merchant_id: string;
  host_merchant_id: string;
  host_store_name: string;
  line_items: MarketplaceOrderLineItem[];
  total_amount: number;
  status: "pending" | "partial_shipped" | "shipped" | "delivered";
  created_at: string;
  updated_at: string;
}

export interface MarketplaceStats {
  pending_orders: number;
  monthly_revenue: number;
  items_shipped: number;
  fulfillment_rate: number;
}
