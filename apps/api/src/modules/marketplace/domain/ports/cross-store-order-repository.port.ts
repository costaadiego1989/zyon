export const CROSS_STORE_ORDER_REPOSITORY = Symbol(
  "CROSS_STORE_ORDER_REPOSITORY",
);

export interface CrossStoreLineItemSnapshot {
  id: string;
  checkoutSessionId: string;
  orderId: string | null;
  hostMerchantId: string;
  sellerMerchantId: string;
  federatedProductId: string;
  productName?: string;
  hostStoreName?: string;
  quantity: number;
  unitPriceCents: number;
  commissionRateBps: number;
  commissionCents: number;
  sellerNetCents: number;
  purchasedAt?: Date | null;
  termsJson?: { returnWindowDays: number; payoutDelayDays: number; chargebackWindowDays: number };
  fulfillmentStatus: string;
  fulfillmentReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCrossStoreLineItemInput {
  termsJson?: { returnWindowDays: number; payoutDelayDays: number; chargebackWindowDays: number };
  checkoutSessionId: string;
  hostMerchantId: string;
  sellerMerchantId: string;
  federatedProductId: string;
  quantity: number;
  unitPriceCents: number;
  commissionRateBps: number;
  commissionCents: number;
  sellerNetCents: number;
}

export interface UpdateCrossStoreFulfillmentInput {
  lineItemId: string;
  sellerMerchantId: string;
  expectedStatus: "pending" | "shipped";
  status: "shipped" | "delivered";
  fulfillmentReference?: string;
}

export interface CrossStoreOrderRepository {
  create(
    input: CreateCrossStoreLineItemInput,
  ): Promise<CrossStoreLineItemSnapshot>;
  findByCheckoutSessionId(
    checkoutSessionId: string,
    hostMerchantId: string,
  ): Promise<CrossStoreLineItemSnapshot[]>;
  findByOrderId(orderId: string): Promise<CrossStoreLineItemSnapshot[]>;
  findBySellerMerchantId(
    sellerMerchantId: string,
  ): Promise<CrossStoreLineItemSnapshot[]>;
  findByIdForSeller(
    lineItemId: string,
    sellerMerchantId: string,
  ): Promise<CrossStoreLineItemSnapshot | undefined>;
  updateFulfillment(
    input: UpdateCrossStoreFulfillmentInput,
  ): Promise<CrossStoreLineItemSnapshot | undefined>;
  updateOrderId(
    lineItemId: string,
    orderId: string,
  ): Promise<CrossStoreLineItemSnapshot>;
}
