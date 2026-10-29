import { Injectable } from "@nestjs/common";
import type {
  FederatedProductRepository,
  FederatedProductSnapshot,
} from "../../domain/ports/federated-product-repository.port.js";
import type { MarketplaceConfigRepository } from "../../domain/ports/marketplace-config-repository.port.js";
import { FederatedSearchService } from "../../domain/services/federated-search.service.js";
import { PrismaClient } from "@prisma/client";
import type { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";
import { BILLING_PLANS } from "../../../payment/domain/billing-plans.js";

export interface SearchFederatedProductsInput {
  hostMerchantId: string;
  query: string;
  category?: string;
  limit?: number;
  maxPriceCents?: number;
}

export interface SearchFederatedProductsOutput {
  products: FederatedProductSnapshot[];
}

@Injectable()
export class SearchFederatedProductsUseCase {
  constructor(
    private readonly federatedProductRepository: FederatedProductRepository,
    private readonly configRepository: MarketplaceConfigRepository,
    private readonly federatedSearchService: FederatedSearchService,
    private readonly prisma: PrismaClient,
    private readonly billing: Pick<BillingPlanMeteringService, "getEffectivePlan">,
  ) {}

  private async eligibleMerchant(merchantId: string): Promise<boolean> {
    // Use the effective subscription, including expiry and Scale billing-account
    // inheritance; an old enabled flag alone is not an entitlement.
    const plan = await this.billing.getEffectivePlan(merchantId);
    return plan === "scale" && BILLING_PLANS[plan].features.marketplace;
  }

  async execute(
    input: SearchFederatedProductsInput,
  ): Promise<SearchFederatedProductsOutput> {
    const config = await this.configRepository.get(input.hostMerchantId);
    if (!config?.enabled) {
      return { products: [] };
    }
    if (!await this.eligibleMerchant(input.hostMerchantId)) return { products: [] };

    const excludeMerchants = config?.blockedMerchants ?? [];

    const connections = await this.prisma.marketplaceConnection.findMany({
      where: { buyerMerchantId: input.hostMerchantId, status: "active" },
      select: { sellerMerchantId: true },
    });
    const eligible = await Promise.all(connections.map(async (c) => {
      const seller = await this.configRepository.get(c.sellerMerchantId);
      return seller?.enabled && !excludeMerchants.includes(c.sellerMerchantId)
        && !seller.blockedMerchants?.includes(input.hostMerchantId) && await this.eligibleMerchant(c.sellerMerchantId) ? c.sellerMerchantId : undefined;
    }));
    const includeMerchants = eligible.filter((id): id is string => Boolean(id));

    if (includeMerchants.length === 0) {
      return { products: [] };
    }

    const results = await this.federatedSearchService.search({
      hostMerchantId: input.hostMerchantId,
      query: input.query,
      category: input.category,
      limit: input.limit ?? 20,
      excludeMerchants,
      includeMerchants,
      maxPriceCents: input.maxPriceCents,
    });

    const products = await Promise.all(
      results.map(async (r) => {
        const prod = await this.federatedProductRepository.getById(r.id);
        return prod;
      }),
    );

    return {
      products: products.filter((p): p is FederatedProductSnapshot => p !== undefined
        && includeMerchants.includes(p.sourceMerchantId) && p.stockAvailable && p.currency === "BRL"
        && (input.maxPriceCents === undefined || p.priceCents <= input.maxPriceCents)),
    };
  }

  async getAuthorizedById(hostMerchantId: string, productId: string): Promise<FederatedProductSnapshot | undefined> {
    if (!await this.eligibleMerchant(hostMerchantId)) return undefined;
    const product = await this.federatedProductRepository.getById(productId);
    if (!product) return undefined;
    if (!await this.eligibleMerchant(product.sourceMerchantId)) return undefined;
    const [host, seller, connection] = await Promise.all([
      this.configRepository.get(hostMerchantId), this.configRepository.get(product.sourceMerchantId),
      this.prisma.marketplaceConnection.findFirst({ where: { buyerMerchantId: hostMerchantId, sellerMerchantId: product.sourceMerchantId, status: "active" }, select: { id: true } }),
    ]);
    return host?.enabled && seller?.enabled && connection && !host.blockedMerchants?.includes(product.sourceMerchantId)
      && !seller.blockedMerchants?.includes(hostMerchantId) ? product : undefined;
  }
}
