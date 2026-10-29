export interface SupportOrderItem {
  variantId: string;
  sku?: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  eligibleQuantity: number;
}
export interface SupportOrder {
  orderId: string;
  merchantId: string;
  completedAt: string;
  currency: string;
  totalCents: number;
  shippingCents: number;
  paymentStatus: string;
  paymentMethod?: string;
  trackingCode?: string | null;
  items: SupportOrderItem[];
}
export interface SupportCaseMessage {
  id: string;
  ticketId: string;
  senderType: "buyer" | "merchant" | "system";
  content: string;
  createdAt: string;
  metadata?: { kind?: string; imageUrls?: string[]; [key: string]: unknown } | null;
}
export interface SupportCaseSummary {
  ticketId: string;
  merchantId: string;
  returnId?: string | null;
  orderId?: string | null;
  kind: "refund" | "exchange" | "support";
  status: string;
  returnStatus?: string | null;
  returnAuthorized?: boolean;
  active: boolean;
  unreadCount: number;
  lastMessage?: SupportCaseMessage | null;
  updatedAt: string;
}
export interface SupportCaseDetail extends SupportCaseSummary {
  returnShipping?: { authorized: boolean; awaitingCode: boolean; carrier: string | null;
    postingCode: string | null; labelUrl: string | null; expiresAt: string | null;
    declarations: Array<{ originMerchantId: string; originName: string; url: string | null }> };
  order?: SupportOrder | null;
  reason?: string;
  reasonLabel?: string;
  notes?: string | null;
  selectedItems: Array<{ variantId: string; quantity: number; name: string }>;
  imageUrls: string[];
  messages: SupportCaseMessage[];
  nextCursor?: string | null;
  notifications?: Array<{ id: string; type: string; channel: string; status: string; lastError: string | null }>;
  refund?: { status: string; amountInCents: number; providerRefundId?: string | null } | null;
  resolution?: { instructions?: string; replacementOrderId?: string; trackingCode?: string; [key: string]: unknown } | null;
}
export interface ReturnRequestResult {
  returnId: string;
  ticketId: string;
  status: string;
  existing: boolean;
}
export interface SupportRefundPreview {
  amountCents: number;
  capturedCents: number;
  reservedCents: number;
  availableCents: number;
  currency: string;
  paymentIntentId: string;
  paymentMethod: string;
  items: Array<{ variantId: string; name: string; quantity: number; unitPriceCents: number }>;
  provider: string;
  automatic: boolean;
}
