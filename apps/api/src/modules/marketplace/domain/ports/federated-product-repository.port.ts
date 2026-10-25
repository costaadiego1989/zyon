export const FEDERATED_PRODUCT_REPOSITORY = Symbol(
  "FEDERATED_PRODUCT_REPOSITORY",
);

export interface FederatedProductSnapshot {
  id: string;
  sourceMerchantId: string;
  sourceProductId: string;
  name: string;
  description: string | null;
  category: string | null;
  priceCents: number;
  currency: string;
  stockAvailable: boolean;
  imageUrl: string | null;
  searchableText: string;
  createdAt: Date;
  syncedAt: Date;
}

export interface UpsertFederatedProductInput {
  sourceMerchantId: string;
  sourceProductId: string;
  name: string;
  description?: string;
  category?: string;
  priceCents: number;
  currency?: string;
  stockAvailable?: boolean;
  imageUrl?: string;
}

export interface FederatedProductSearchParams {
  hostMerchantId: string;
  query: string;
  limit: number;
  excludeMerchants?: string[];
}

export interface FederatedProductRepository {
  search(params: FederatedProductSearchParams): Promise<FederatedProductSnapshot[]>;
  upsert(input: UpsertFederatedProductInput): Promise<FederatedProductSnapshot>;
  delete(sourceMerchantId: string, sourceProductId: string): Promise<void>;
  getById(id: string): Promise<FederatedProductSnapshot | undefined>;
  listByMerchant(sourceMerchantId: string): Promise<FederatedProductSnapshot[]>;
}
