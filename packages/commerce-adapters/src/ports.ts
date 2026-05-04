export type TrustedCartLine = {
  sku: string;
  quantity: number;
  unitPriceCents: number;
  title: string;
};

export type TrustedCartSnapshot = {
  currency: string;
  totalCents: number;
  lines: TrustedCartLine[];
  commerceCartRef: string;
};

export interface CommerceCartPort {
  validateCart(input: { merchantId: string; commerceCartRef: string }): Promise<TrustedCartSnapshot>;
}

export interface CommerceOrderPort {
  createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }>;
  markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void>;
}

export interface CommerceOfferPort {
  buildOfferMetadata(input: { authorizedOfferId: string; discountCents: number }): Promise<Record<string, unknown>>;
}
