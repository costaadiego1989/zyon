import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { Inject } from "@nestjs/common";
import { extractOptionGroups, resolveSelectedOptions } from "../../domain/food-options.js";
import { isMarketplaceVariantPrice, marketplaceVariantInStock, marketplaceVariantLabel } from "../../../marketplace/domain/services/marketplace-variant.js";
import { assertMarketplaceProductOptions } from "../../../marketplace/domain/services/marketplace-product-options.js";
import { assertMarketplacePartners } from "../../../marketplace/infrastructure/repositories/prisma-marketplace-cart.repository.js";
import { BILLING_PLANS } from "../../../payment/domain/billing-plans.js";
import { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";

export interface SearchMarketplaceProductsInput {
  merchantId: string;
  query: string;
  category?: string;
  limit?: number;
}

export interface FederatedProductResponse {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  image?: string;
  sellerName: string;
  sellerId: string;
  inStock: boolean;
  variants: Array<{ id: string; label: string; price: number; priceFormatted: string; inStock: boolean }>;
}

export interface SearchMarketplaceProductsOutput {
  products: FederatedProductResponse[];
}

@Injectable()
export class SearchMarketplaceProductsStorefrontUseCase {
  constructor(
    private readonly searchFederated: SearchFederatedProductsUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly billing: BillingPlanMeteringService,
  ) {}

  async execute(input: SearchMarketplaceProductsInput): Promise<SearchMarketplaceProductsOutput> {
    if (!(await this.marketplaceEnabled(input.merchantId))) return { products: [] };
    const requestedLimit = input.limit ?? 10;
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, Math.trunc(requestedLimit))) : 10;
    const result = await this.searchFederated.execute({
      hostMerchantId: input.merchantId,
      query: input.query,
      category: input.category,
      limit: Math.min(20, limit * 2),
    });
    if (!result.products.length) return { products: [] };

    const canonical = await Promise.all(result.products.slice(0, 20).map(p => this.canonicalProduct(input.merchantId, p)));
    const ranked = this.rankProducts(canonical.filter(Boolean), input.query);
    return { products: ranked.slice(0, limit).map(({ description, priceCents, score, ...product }) => product) };
  }

  async resolveById(input: { merchantId: string; federatedProductId: string }): Promise<FederatedProductResponse | undefined> {
    if (typeof input.merchantId !== "string" || !input.merchantId.trim() || typeof input.federatedProductId !== "string" ||
        !input.federatedProductId || input.federatedProductId.length > 200 || /[\u0000-\u0020\u007f]/.test(input.federatedProductId)) return undefined;
    if (!(await this.marketplaceEnabled(input.merchantId))) return undefined;
    const projection = await this.prisma.federatedProduct.findUnique({ where: { id: input.federatedProductId } });
    if (!projection) return undefined;
    const product = await this.canonicalProduct(input.merchantId, projection);
    if (!product) return undefined;
    const { description, priceCents, ...response } = product;
    return response;
  }

  private async marketplaceEnabled(merchantId: string): Promise<boolean> {
    try {
      return BILLING_PLANS[await this.billing.getEffectivePlan(merchantId)].features.marketplace;
    } catch {
      // This public surface must fail closed if the subscription cannot be read.
      return false;
    }
  }

  private async canonicalProduct(merchantId: string, p: { id: string; sourceProductId: string; sourceMerchantId: string; imageUrl?: string | null }) {
    const formatPrice = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      // Cross-merchant reads remain pinned to the product/seller pair admitted by federated search.
      const rows = await this.prisma.productVariant.findMany({ where: { productId: p.sourceProductId, isActive: true,
        product: { merchantId: p.sourceMerchantId, isActive: true, deletedAt: null } }, orderBy: { id: "asc" }, take: 51,
        include: { product: true, price: true, stock: true, media: { where: { type: "IMAGE" }, orderBy: { order: "asc" }, take: 1 } } });
      // An incomplete option list must not authorize a guessed selection.
      if (!rows.length || rows.length > 50) return undefined;
      const product = rows[0]!.product;
      if (!product.isActive || product.deletedAt || product.id !== p.sourceProductId || product.merchantId !== p.sourceMerchantId) return undefined;
      let sellerName: string;
      try {
        // A direct ID is not permission to read a seller. Recheck current
        // commercial/category bindings for both search and details projection.
        sellerName = (await assertMarketplacePartners(this.prisma, merchantId, p.sourceMerchantId, product.categoryId)).sellerName;
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException) return undefined;
        throw error;
      }
      try { assertMarketplaceProductOptions(product.metadata); resolveSelectedOptions(extractOptionGroups(product.metadata), []); }
      catch { return undefined; }
      const valid = rows.filter(row => row.isActive && row.productId === p.sourceProductId && row.product.merchantId === p.sourceMerchantId
        && row.product.isActive && !row.product.deletedAt && isMarketplaceVariantPrice(row.price?.basePriceInCents, row.price?.currency));
      if (!valid.length) return undefined;
      const variants = valid.map(row => ({ id: row.id, label: marketplaceVariantLabel(row.attributes, row.sku),
        price: row.price!.basePriceInCents / 100, priceFormatted: formatPrice(row.price!.basePriceInCents),
        inStock: marketplaceVariantInStock(product.type, row.stock) }));
      const available = variants.filter(variant => variant.inStock);
      const minPrice = Math.min(...(available.length ? available : variants).map(variant => variant.price));
      return { id: p.id, name: product.name, description: product.description, priceCents: Math.round(minPrice * 100),
        price: minPrice, priceFormatted: formatPrice(Math.round(minPrice * 100)), image: valid[0]!.media[0]?.url ?? p.imageUrl ?? undefined,
        sellerName: sellerName || "Loja parceira", sellerId: p.sourceMerchantId,
        inStock: available.length > 0, variants };
  }

  private rankProducts(
    products: any[],
    query: string,
  ): any[] {
    const normalized = query.toLowerCase().trim();

    const scored = products.map((p) => {
      const nameLower = p.name.toLowerCase();
      let score = 0;

      if (nameLower === normalized) {
        score = 100;
      } else if (nameLower.startsWith(normalized)) {
        score = 80;
      } else if (nameLower.includes(normalized)) {
        score = 60;
      } else if (p.description?.toLowerCase().includes(normalized)) {
        score = 40;
      }

      return { ...p, score };
    });

    const sorted = scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.priceCents !== b.priceCents) return a.priceCents - b.priceCents;
      return 0;
    });

    const seen = new Set<string>();
    const diversified: any[] = [];

    for (const product of sorted) {
      const key = product.name;
      if (!seen.has(key)) {
        seen.add(key);
        diversified.push(product);
      } else {
        diversified.push(product);
      }
    }

    return diversified;
  }
}
