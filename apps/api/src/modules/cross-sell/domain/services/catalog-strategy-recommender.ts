import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

/**
 * Catalog-driven cross-sell strategies. Unlike promotion-based strategies (which
 * require manually configured cross_sell_promotions rows), these derive
 * suggestions directly from the merchant's live catalog, so a merchant that only
 * toggled strategies in the dashboard (without creating promotions) still gets
 * relevant cross-sell — the strategy IS the recommender.
 *
 * All methods return commercial SKUs (strings), excluding SKUs already in the
 * cart. Empty array when no signal exists. Results are lightly cached per
 * merchant + cart shape to avoid re-scanning the catalog on every add-to-cart.
 */
@Injectable()
export class CatalogStrategyRecommender {
  private readonly logger = new Logger(CatalogStrategyRecommender.name);
  private readonly cache = new Map<string, { skus: string[]; expiresAt: number }>();
  private static readonly TTL_MS = 10 * 60 * 1000;
  private static readonly MAX_SCAN = 200;

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  /**
   * same_category: products in the same category as the cart items. Excludes
   * items already in the cart. Ordered by in-stock first, then price ascending
   * (cheaper add-ons convert better as impulse cross-sell).
   */
  async sameCategory(merchantId: string, cartSkus: string[], limit = 3): Promise<string[]> {
    if (!merchantId || cartSkus.length === 0) return [];
    const key = this.cacheKey("cat", merchantId, cartSkus, limit);
    const hit = this.readCache(key);
    if (hit) return hit;

    try {
      const cartSet = new Set(cartSkus.map((s) => s.toLowerCase()));
      // Categories present in the cart.
      const cartVariants = await this.prisma.productVariant.findMany({
        where: { sku: { in: cartSkus }, product: { merchantId } },
        select: { product: { select: { categoryId: true } } },
      });
      const categoryIds = [...new Set(
        cartVariants.map((v: any) => v.product?.categoryId).filter((c: unknown): c is string => Boolean(c)),
      )];
      if (categoryIds.length === 0) return this.store(key, []);

      const variants = await this.prisma.productVariant.findMany({
        where: {
          isActive: true,
          product: { merchantId, isActive: true, categoryId: { in: categoryIds } },
        },
        select: { sku: true, price: { select: { basePriceInCents: true } }, stock: { select: { quantity: true } } },
        take: CatalogStrategyRecommender.MAX_SCAN,
      });

      const ranked = variants
        .filter((v: any) => v.sku && !cartSet.has(v.sku.toLowerCase()))
        .map((v: any) => ({
          sku: v.sku as string,
          price: v.price?.basePriceInCents ?? Number.MAX_SAFE_INTEGER,
          stock: (v.stock ?? []).reduce((s: number, r: { quantity: number }) => s + r.quantity, 0),
        }))
        .sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0) || a.price - b.price)
        .slice(0, limit)
        .map((v) => v.sku);

      return this.store(key, ranked);
    } catch (err) {
      this.logger.warn(`[cross-sell] sameCategory failed for merchant=${merchantId}`, err as Error);
      return [];
    }
  }

  /**
   * cart_value_upgrade: active products priced above the cart's current average
   * line price — nudges the buyer toward a higher-value add-on. Ordered by price
   * ascending above the threshold (closest upgrade first).
   */
  async cartValueUpgrade(merchantId: string, cartSkus: string[], cartTotal: number, limit = 3): Promise<string[]> {
    if (!merchantId || cartSkus.length === 0) return [];
    const threshold = cartSkus.length > 0 ? cartTotal / cartSkus.length : cartTotal;
    const thresholdCents = Math.round(threshold * 100);
    const key = this.cacheKey(`upg${thresholdCents}`, merchantId, cartSkus, limit);
    const hit = this.readCache(key);
    if (hit) return hit;

    try {
      const cartSet = new Set(cartSkus.map((s) => s.toLowerCase()));
      const variants = await this.prisma.productVariant.findMany({
        where: {
          isActive: true,
          product: { merchantId, isActive: true },
          price: { basePriceInCents: { gt: thresholdCents } },
        },
        select: { sku: true, price: { select: { basePriceInCents: true } } },
        orderBy: { price: { basePriceInCents: "asc" } },
        take: CatalogStrategyRecommender.MAX_SCAN,
      });

      const ranked = variants
        .filter((v: any) => v.sku && !cartSet.has(v.sku.toLowerCase()))
        .slice(0, limit)
        .map((v: any) => v.sku as string);

      return this.store(key, ranked);
    } catch (err) {
      this.logger.warn(`[cross-sell] cartValueUpgrade failed for merchant=${merchantId}`, err as Error);
      return [];
    }
  }

  private cacheKey(prefix: string, merchantId: string, cartSkus: string[], limit: number): string {
    return `${prefix}:${merchantId}:${[...cartSkus].map((s) => s.toLowerCase()).sort().join(",")}:${limit}`;
  }

  private readCache(key: string): string[] | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.skus;
    return null;
  }

  private store(key: string, skus: string[]): string[] {
    this.cache.set(key, { skus, expiresAt: Date.now() + CatalogStrategyRecommender.TTL_MS });
    return skus;
  }
}
