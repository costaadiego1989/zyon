export type TrustedCartLine = {
  sku: string;
  quantity: number;
  unitPriceCents: number;
  title: string;
  commerceProductId?: string;
  commerceVariantId?: string;
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
  cancelOrder?(input: {
    merchantId: string;
    commerceOrderId: string;
    reason: string;
    notifyCustomer?: boolean;
    restock?: boolean;
  }): Promise<void>;
}

export interface CommerceOfferPort {
  buildOfferMetadata(input: { authorizedOfferId: string; discountCents: number }): Promise<Record<string, unknown>>;
}

export type CommerceCatalogVariant = {
  id: string;
  sku: string;
  title: string;
  unitPriceCents: number;
  currency: string;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  imageUrl?: string;
};

export type CommerceCatalogProduct = {
  id: string;
  title: string;
  description?: string;
  productUrl?: string;
  imageUrl?: string;
  category?: string;
  variants: CommerceCatalogVariant[];
};

export type CommerceCatalogPage = {
  products: CommerceCatalogProduct[];
  nextCursor: string | null;
};

export interface CommerceCatalogPort {
  searchCatalog(input: {
    merchantId: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CommerceCatalogPage>;
  findCatalogProductBySku(input: {
    merchantId: string;
    sku: string;
  }): Promise<CommerceCatalogProduct | null>;
}

export type CommerceConnectionHealth = {
  provider: "shopify" | "woocommerce" | "nuvemshop" | "tray" | "vtex" | "magento";
  storeName: string;
  storeUrl: string;
  currency: string;
};

export interface CommerceConnectionTestPort {
  testConnection(): Promise<CommerceConnectionHealth>;
}

export interface CommerceProviderPort
  extends CommerceCartPort,
    CommerceOrderPort,
    CommerceCatalogPort,
    CommerceConnectionTestPort {}
