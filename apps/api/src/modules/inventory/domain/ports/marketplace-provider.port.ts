export const MARKETPLACE_PROVIDER_PORT = Symbol("MARKETPLACE_PROVIDER_PORT");

export interface MarketplaceProduct {
  id: string;
  title: string;
  sku?: string;
  stock: number;
}

export interface MarketplaceProviderPort {
  listProducts(
    accessToken: string,
    page?: number,
  ): Promise<{ products: MarketplaceProduct[]; hasMore: boolean }>;

  updateStock(
    accessToken: string,
    itemId: string,
    quantity: number,
  ): Promise<boolean>;

  getSellerInfo(
    accessToken: string,
  ): Promise<{ sellerId: string; name: string }>;
}
