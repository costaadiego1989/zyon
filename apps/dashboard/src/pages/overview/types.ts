export type Period = "today" | "7d" | "30d" | "90d";

export interface StoreOverview {
  merchant_id: string;
  period: string;
  revenue: number;
  orders_count: number;
  average_ticket: number;
  products_sold: number;
  new_customers: number;
  abandonment_rate: number;
  orders_by_status: Record<string, number>;
  top_products: Array<{
    product_id: string;
    name: string;
    image_url?: string;
    quantity: number;
    revenue: number;
  }>;
  recent_orders: Array<{
    id: string;
    buyer_name: string;
    total: number;
    status: string;
    created_at: string;
  }>;
}

export interface TimeseriesResponse {
  merchant_id: string;
  period: string;
  revenue_daily: Array<{ date: string; value: number }>;
  orders_daily: Array<{ date: string; value: number }>;
  sessions_daily: Array<{ date: string; value: number }>;
  conversion_daily: Array<{ date: string; value: number }>;
}
