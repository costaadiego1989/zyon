import type { CurrencyCode } from "@zyon/shared-types";

export type DiscountSensitivity = "unknown" | "low" | "medium" | "high";

export interface PurchaseHistoryIdentity {
  merchantId: string;
  globalUserId?: string;
  merchantCustomerId?: string;
}

export interface PurchaseHistoryItem {
  sku: string;
  title: string;
  categoryId?: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
}

export interface PurchaseRecord extends PurchaseHistoryIdentity {
  orderId: string;
  currency: CurrencyCode;
  totalAmount: number;
  discountAmount: number;
  completedAt: string;
  items: PurchaseHistoryItem[];
}

export interface BuyerMerchantStats extends PurchaseHistoryIdentity {
  ordersCount: number;
  lifetimeValue: number;
  averageOrderValue: number;
  lastOrderAt?: string;
  topCategories: string[];
  topSkus: string[];
  discountSensitivity: DiscountSensitivity;
}

export interface BuyerPurchaseHistorySnapshot extends PurchaseHistoryIdentity {
  purchases: PurchaseRecord[];
}

export interface BuyerPurchaseHistoryContext {
  merchant_id: string;
  global_user_id?: string;
  merchant_customer_id?: string;
  purchase_history: {
    known_buyer: boolean;
    orders_count: number;
    lifetime_value: number;
    average_order_value: number;
    last_order_at?: string;
    top_categories: string[];
    recent_skus: string[];
    discount_sensitivity: DiscountSensitivity;
    returning_customer_copy_hint: string;
  };
}
