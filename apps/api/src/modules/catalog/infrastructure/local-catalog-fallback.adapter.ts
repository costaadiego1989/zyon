import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { SuggestedProduct } from "@zyon/shared-types";
import type { ProductSearchPort } from "../../checkout/domain/ports/product-search.port.js";

/**
 * Local catalog adapter that searches cross-sell promotions as a fallback
 * product catalog. Used when no commerce provider (Shopify/WooCommerce)
 * is connected — the dev/demo path.
 */
@Injectable()
export class LocalCatalogFallbackAdapter implements ProductSearchPort {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, query: string, limit = 8): Promise<SuggestedProduct[]> {
    const normalizedQuery = query.toLowerCase().trim();

    const promotions = await this.prisma.crossSellPromotion.findMany({
      where: { merchantId, status: "active" },
      select: { name: true, recommendedSkus: true, discountPercent: true, trigger: true }
    });

    const seen = new Set<string>();
    const matches: SuggestedProduct[] = [];

    for (const promo of promotions) {
      for (const sku of promo.recommendedSkus) {
        if (seen.has(sku)) continue;
        seen.add(sku);

        if (this.matchesQuery(sku, promo.name, normalizedQuery)) {
          matches.push(this.toProduct(sku, promo.name));
        }
      }
    }

    // If query yielded nothing, return the full catalog for browsing
    if (matches.length === 0) {
      for (const promo of promotions) {
        for (const sku of promo.recommendedSkus) {
          if (seen.has(sku)) continue;
          seen.add(sku);
          matches.push(this.toProduct(sku, promo.name));
        }
      }
    }

    return matches.slice(0, limit);
  }

  async findBySku(merchantId: string, sku: string): Promise<SuggestedProduct | null> {
    const promo = await this.prisma.crossSellPromotion.findFirst({
      where: { merchantId, status: "active", recommendedSkus: { has: sku } }
    });
    return promo ? this.toProduct(sku, promo.name) : null;
  }

  private matchesQuery(sku: string, promoName: string, normalizedQuery: string): boolean {
    if (!normalizedQuery) return true;
    return (
      sku.toLowerCase().includes(normalizedQuery) ||
      promoName.toLowerCase().includes(normalizedQuery) ||
      humanizeSku(sku).toLowerCase().includes(normalizedQuery)
    );
  }

  private toProduct(sku: string, promoName: string): SuggestedProduct {
    return {
      sku,
      name: humanizeSku(sku),
      unit_price: estimatePrice(sku),
      category: extractCategory(sku),
      variant: extractVariant(sku),
    };
  }
}

export function humanizeSku(sku: string): string {
  return sku
    .replace(/^(lux|tech|fash)_/, "")
    .replace(/_\d+$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function estimatePrice(sku: string): number {
  if (sku.startsWith("lux_")) return 450;
  if (sku.startsWith("tech_")) return 250;
  if (sku.startsWith("fash_")) return 180;
  return 100;
}

function extractCategory(sku: string): string {
  if (sku.startsWith("lux_")) return "luxury-accessories";
  if (sku.startsWith("tech_")) return "electronics";
  if (sku.startsWith("fash_")) return "apparel";
  return "general";
}

function extractVariant(sku: string): string | undefined {
  if (sku.startsWith("lux_")) return "couro premium";
  if (sku.startsWith("tech_")) return "tech premium";
  if (sku.startsWith("fash_")) return "casual";
  return undefined;
}