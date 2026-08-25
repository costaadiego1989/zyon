export interface SaleCompletedEvent {
  merchantId: string;
  orderId: string;
  items: Array<{
    sku: string;
    quantity: number;
    variantId?: string;
  }>;
  buyerEmail?: string;
  buyerName?: string;
  buyerPhone?: string;
  totalCents: number;
  timestamp: string;
}
