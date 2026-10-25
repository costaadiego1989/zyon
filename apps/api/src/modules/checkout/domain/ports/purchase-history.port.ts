import type { CurrencyCode } from "@zyon/shared-types";

export const PURCHASE_HISTORY_PORT = Symbol("PURCHASE_HISTORY_PORT");

export interface RecordCheckoutPurchaseInput {
  merchantId: string;
  sessionId: string;
  globalUserId: string;
  orderId: string;
  currency: CurrencyCode;
  totalAmount: number;
  discountAmount: number;
  completedAt: string;
  items: Array<{
    sku: string;
    title: string;
    categoryId?: string;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
  }>;
}

export interface PurchaseHistoryPort {
  recordCheckoutPurchase(input: RecordCheckoutPurchaseInput): Promise<void>;
}
