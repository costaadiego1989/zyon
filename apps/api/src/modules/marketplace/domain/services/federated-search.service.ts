export interface FederatedSearchParams {
  hostMerchantId: string;
  query: string;
  category?: string;
  limit: number;
  excludeMerchants: string[];
  includeMerchants?: string[];
}

export interface FederatedProductResult {
  id: string;
  sourceProductId: string;
  sellerMerchantId: string;
  sellerName: string;
  name: string;
  description: string | null;
  category: string | null;
  priceInCents: number;
  currency: string;
  commissionRateBps: number;
  stockAvailable: boolean;
  imageUrl: string | null;
  relevanceScore: number;
}

export interface RawFederatedProduct {
  id: string;
  sourceMerchantId: string;
  sourceProductId: string;
  sellerName: string;
  name: string;
  description: string | null;
  category: string | null;
  priceCents: number;
  currency: string;
  commissionRateBps: number;
  stockAvailable: boolean;
  imageUrl: string | null;
  tsRank: number;
}

export type FederatedSearchRepositoryPort = {
  searchByQuery(
    query: string,
    category: string | undefined,
    limit: number
  ): Promise<RawFederatedProduct[]>;
};

export class FederatedSearchService {
  constructor(private searchRepo: FederatedSearchRepositoryPort) {}

  async search(
    params: FederatedSearchParams
  ): Promise<FederatedProductResult[]> {
    this.validateParams(params);

    const excludeSet = new Set([
      params.hostMerchantId,
      ...params.excludeMerchants,
    ]);

    const rawResults = await this.searchRepo.searchByQuery(
      params.query,
      params.category,
      params.limit
    );

    const includeSet = params.includeMerchants ? new Set(params.includeMerchants) : null;
    const filtered = rawResults.filter(
      (p) => !excludeSet.has(p.sourceMerchantId) && (includeSet === null || includeSet.has(p.sourceMerchantId))
    );

    return filtered.slice(0, params.limit).map((p) => this.mapToResult(p));
  }

  private validateParams(params: FederatedSearchParams): void {
    if (!params.query || params.query.trim().length === 0) {
      throw new Error("Query must not be empty");
    }

    if (params.query.length > 200) {
      throw new Error("Query must be at most 200 characters");
    }

    if (params.limit < 1 || params.limit > 20) {
      throw new Error("Limit must be between 1 and 20");
    }

    if (!params.hostMerchantId || params.hostMerchantId.trim().length === 0) {
      throw new Error("Host merchant ID is required");
    }
  }

  private mapToResult(raw: RawFederatedProduct): FederatedProductResult {
    return {
      id: raw.id,
      sourceProductId: raw.sourceProductId,
      sellerMerchantId: raw.sourceMerchantId,
      sellerName: raw.sellerName,
      name: raw.name,
      description: raw.description,
      category: raw.category,
      priceInCents: raw.priceCents,
      currency: raw.currency,
      commissionRateBps: raw.commissionRateBps,
      stockAvailable: raw.stockAvailable,
      imageUrl: raw.imageUrl,
      relevanceScore: Math.min(100, Math.round(raw.tsRank)),
    };
  }
}
