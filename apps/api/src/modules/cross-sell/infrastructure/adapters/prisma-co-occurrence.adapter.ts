import type { PrismaClient } from "@prisma/client";
import type { CrossSellCoOccurrencePort } from "../../domain/ports/co-occurrence.port.js";

/**
 * Collaborative-filtering cross-sell: "buyers who bought X also bought Y".
 *
 * Derives recommendations purely from historical co-occurrence in
 * `buyer_purchase_records` — no manually-configured CrossSellPromotion needed.
 * Used as the intelligent fallback for the `ai_personalized` strategy.
 */
export class PrismaCrossSellCoOccurrenceAdapter implements CrossSellCoOccurrencePort {

  // Small in-memory cache: merchant + sorted cart SKUs → recommended SKUs.
  // Avoids re-scanning purchase history on every add-to-cart. TTL 15 min.
  private readonly cache = new Map<string, { skus: string[]; expiresAt: number }>();
  private static readonly TTL_MS = 15 * 60 * 1000;
  private static readonly LOOKBACK_MONTHS = 6;
  private static readonly MAX_ORDERS = 500;

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Given commercial SKUs currently in the cart, return the commercial SKUs
   * that most frequently co-occur with them in past orders of this merchant.
   * Excludes SKUs already in the cart. Empty array when no signal exists.
   */
  async recommend(merchantId: string, cartCommercialSkus: string[], limit = 3): Promise<string[]> {
    if (!merchantId || cartCommercialSkus.length === 0) return [];

    const cartSet = new Set(cartCommercialSkus.map((s) => s.toLowerCase()));
    const cacheKey = `${merchantId}:${[...cartSet].sort().join(",")}:${limit}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.skus;

    try {
      const since = new Date();
      since.setMonth(since.getMonth() - PrismaCrossSellCoOccurrenceAdapter.LOOKBACK_MONTHS);

      const rows = await this.prisma.buyerPurchaseRecord.findMany({
        where: { merchantId, completedAt: { gte: since } },
        select: { items: true },
        orderBy: { completedAt: "desc" },
        take: PrismaCrossSellCoOccurrenceAdapter.MAX_ORDERS,
      });

      // Collect the raw variant IDs used across all orders so we can resolve
      // them to commercial SKUs in a single query.
      const orders: string[][] = [];
      const allVariantIds = new Set<string>();
      for (const row of rows) {
        const items = Array.isArray(row.items) ? (row.items as Array<{ sku?: string }>) : [];
        const skus = items.map((i) => i?.sku).filter((s): s is string => Boolean(s));
        if (skus.length > 0) {
          orders.push(skus);
          for (const s of skus) allVariantIds.add(s);
        }
      }
      if (orders.length === 0) return this.store(cacheKey, []);

      // Resolve variant IDs → commercial SKUs (purchase items store variant IDs).
      const variants = await this.prisma.productVariant.findMany({
        where: { id: { in: [...allVariantIds] } },
        select: { id: true, sku: true },
      });
      const idToSku = new Map<string, string>();
      for (const v of variants) if (v.sku) idToSku.set(v.id, v.sku);
      const norm = (raw: string) => (idToSku.get(raw) ?? raw).toLowerCase();

      // Count co-occurrences: for each order containing a cart SKU, tally the
      // other SKUs in that order.
      const coCounts = new Map<string, number>();
      for (const orderSkus of orders) {
        const normalized = orderSkus.map(norm);
        const hasCartItem = normalized.some((s) => cartSet.has(s));
        if (!hasCartItem) continue;
        for (const s of normalized) {
          if (cartSet.has(s)) continue;
          coCounts.set(s, (coCounts.get(s) ?? 0) + 1);
        }
      }

      const ranked = [...coCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([sku]) => sku);

      return this.store(cacheKey, ranked);
    } catch (err) {
      console.warn(
        `[cross-sell] co-occurrence recommend failed for merchant=${merchantId}:`,
        err instanceof Error ? err.message : String(err)
      );
      return [];
    }
  }

  private store(key: string, skus: string[]): string[] {
    this.cache.set(key, { skus, expiresAt: Date.now() + PrismaCrossSellCoOccurrenceAdapter.TTL_MS });
    return skus;
  }
}
