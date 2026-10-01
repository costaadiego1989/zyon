export const MARKETPLACE_PROVIDER_PORT = Symbol("MARKETPLACE_PROVIDER_PORT");

export interface MarketplaceProduct {
  id: string;
  title: string;
  sku?: string;
  stock: number;
  salePriceCents?: number;
}

/** Business identifiers belong to the connection, never to process-wide env. */
export interface MarketplaceContext {
  sellerId?: string;
  shopId?: string;
  shopCipher?: string;
  sellerName?: string;
}

export interface MarketplacePage {
  products: MarketplaceProduct[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface MarketplaceProviderPort {
  listProducts(
    accessToken: string,
    page?: number,
    cursor?: string,
  ): Promise<MarketplacePage>;

  updateStock(
    accessToken: string,
    itemId: string,
    quantity: number,
  ): Promise<boolean>;

  getSellerInfo(
    accessToken: string,
  ): Promise<{ sellerId: string; name: string; shopCipher?: string }>;
}
