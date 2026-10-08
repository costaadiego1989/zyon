import type { PrismaClient } from "@prisma/client";
import { normalizeCrossSellConfig } from "@zyon/shared-types";
import { PrismaCatalogStrategyAdapter } from "../../../cross-sell/infrastructure/adapters/prisma-catalog-strategy.adapter.js";
import { PrismaCrossSellCoOccurrenceAdapter } from "../../../cross-sell/infrastructure/adapters/prisma-co-occurrence.adapter.js";
import { buildPreCartCrossSellPreview, type PublicCrossSellPreview } from "./pre-cart-cross-sell-preview.js";

/** Public product views never create carts, suggestions or outbox records. */
export class PublicProductCrossSellPreview {
  constructor(private readonly prisma: PrismaClient) {}

  async suggest(merchantId: string, settings: unknown, viewedSkus: string[], viewedCategory?: string | null): Promise<PublicCrossSellPreview | undefined> {
    const raw = settings && typeof settings === "object" ? (settings as Record<string, any>).crossSell : undefined;
    const config = normalizeCrossSellConfig(raw);
    if (!config.enabled || !config.touchpoints.pre_cart || !config.strategies.length || !viewedSkus.length) return undefined;
    try {
      const now = new Date();
      const promotions = await this.prisma.crossSellPromotion.findMany({ where: { merchantId, status: "active", startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        select: { id: true, trigger: true, recommendedSkus: true, discountPercent: true } });
      const products = await this.resolve(merchantId, [...new Set(promotions.flatMap(promo => promo.recommendedSkus))]);
      const preview = buildPreCartCrossSellPreview({ config, viewedSkus, viewedCategory, promotions, products });
      if (preview) return preview;

      const strategy = config.strategies[0];
      const catalog = new PrismaCatalogStrategyAdapter(this.prisma);
      let skus: string[] = [];
      if (strategy === "same_category") skus = await catalog.sameCategory(merchantId, viewedSkus, 3);
      else if (strategy === "cart_value_upgrade") {
        const viewed = await this.prisma.productVariant.findFirst({ where: { sku: { in: viewedSkus }, isActive: true, product: { merchantId, isActive: true, deletedAt: null } }, select: { price: { select: { basePriceInCents: true } } } });
        skus = await catalog.cartValueUpgrade(merchantId, viewedSkus, (viewed?.price?.basePriceInCents ?? 0) / 100, 3);
      } else skus = await new PrismaCrossSellCoOccurrenceAdapter(this.prisma).recommend(merchantId, viewedSkus, 3);
      const excluded = new Set(viewedSkus.map(sku => sku.toLowerCase()));
      const selected = (await this.resolve(merchantId, skus)).filter(product => !excluded.has(product.sku.toLowerCase()) && product.inStock && product.price > 0).slice(0, config.limits.maxSuggestionsPerSession);
      if (!selected.length) return undefined;
      return { trigger: "Complementos para este produto", displayMode: config.display.mode,
        products: selected.map(product => ({ ...product, priceFormatted: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.price) })) };
    } catch { return undefined; }
  }

  private async resolve(merchantId: string, skus: string[]) {
    if (!skus.length) return [];
    const variants = await this.prisma.productVariant.findMany({ where: { sku: { in: skus }, isActive: true, product: { merchantId, isActive: true, deletedAt: null } },
      select: { id: true, sku: true, price: { select: { basePriceInCents: true } }, media: { where: { type: "IMAGE" }, orderBy: { order: "asc" }, take: 1, select: { url: true } },
        stock: { select: { quantity: true, reserved: true } }, product: { select: { name: true, type: true } } } });
    const bySku = new Map(variants.map(variant => [variant.sku, variant]));
    return skus.flatMap(sku => {
      const variant = bySku.get(sku); if (!variant) return [];
      return [{ id: variant.id, sku: variant.sku, name: variant.product.name, price: (variant.price?.basePriceInCents ?? 0) / 100, image: variant.media[0]?.url,
        inStock: variant.product.type === "digital" || variant.product.type === "service" || variant.stock.some(stock => stock.quantity > stock.reserved) }];
    });
  }
}
