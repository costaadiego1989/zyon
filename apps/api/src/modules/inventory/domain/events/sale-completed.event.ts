export interface SaleCompletedEvent {
  merchantId: string;
  orderId: string;
  items: Array<{
    sku: string;
    quantity: number;
    variantId?: string;
    locationId?: string;
  }>;
  buyerEmail?: string;
  buyerName?: string;
  buyerPhone?: string;
  totalCents: number;
  timestamp: string;
}

export interface AppliedInventorySale {
  receiptId: string;
  event: SaleCompletedEvent;
  stockDecrementedCount: number;
  items: Array<{ itemId: string; sku: string; locationId: string; quantity: number; remainingQuantity: number }>;
  idempotent: boolean;
}
