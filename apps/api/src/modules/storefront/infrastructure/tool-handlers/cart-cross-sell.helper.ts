import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import type { PrismaClient } from "@prisma/client";
import { normalizeCrossSellStrategies } from "@zyon/shared-types";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { createShoppingRecommendationReader } from "./shopping-recommendation.handler.js";
import type { ProductHandlerDeps } from "./product.handlers.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";
import type { StorefrontCrossSellCartPort } from "../../domain/ports/storefront-cross-sell-cart.port.js";

export interface CrossSellConfig {
  enabled: boolean;
  touchpoints: { browsing: boolean; pre_cart: boolean; post_cart?: boolean; pre_payment: boolean; post_purchase: boolean };
  discount: { enabled: boolean; mode: string; percent: number; couponCode?: string };
  limits: { maxSuggestionsPerSession: number; cooldownSeconds: number };
  strategies: string[];
  display?: { mode: string };
}

export interface CrossSellSuggestion {
  name: string;
  sku: string;
  productId: string;
  price: number;
  imageUrl?: string;
  discountPercent?: number;
  couponCode?: string;
  promoId?: string;
  recommendationRuleId?: string;
}

export interface CartLineItem {
  variantId: string;
  sku?: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface CartSnapshot {
  sessionId: string;
  total: number;
  items: CartLineItem[];
}

export interface BuildCrossSellDeps {
  productRepo: ProductRepositoryPort;
  prisma: PrismaClient;
  merchantRepo: MerchantRepository;
  listEligibleCrossSells?: ListEligibleCrossSellsUseCase;
  crossSellCart?: Partial<Pick<StorefrontCrossSellCartPort, "quote">>;
}

export async function buildCrossSellSuggestions(
  deps: BuildCrossSellDeps,
  merchantId: string,
  cart: CartSnapshot,
  crossSellConfig: CrossSellConfig,
  productName: string,
  referenceItem?: CartLineItem,
): Promise<CrossSellSuggestion[]> {
  const crossSellSuggestions: CrossSellSuggestion[] = [];
  const maxSuggestions = Math.min(10, crossSellConfig.limits.maxSuggestionsPerSession ?? 3);
  const strategies = normalizeCrossSellStrategies(crossSellConfig.strategies);
  if (maxSuggestions <= 0 || !strategies.length || !deps.listEligibleCrossSells) return [];
  const cartVariantIds = cart.items.map((i) => i.variantId);
  // Product details supply recommendation context without changing the saved cart.
  const contextItems = referenceItem && !cartVariantIds.includes(referenceItem.variantId) ? [...cart.items, referenceItem] : cart.items;
  const variantToSku = new Map<string, string>();
  const variantToCategory = new Map<string, string>();
  try {
    const variants = await deps.prisma.productVariant.findMany({
      where: { id: { in: contextItems.map(item => item.variantId) }, product: { merchantId } },
      select: {
        id: true,
        sku: true,
        product: { select: { categoryId: true, category: { select: { name: true } } } },
      },
    });
    for (const v of variants) {
      if (v.sku) variantToSku.set(v.id, v.sku);
      const catName = v.product?.category?.name ?? v.product?.categoryId;
      if (catName) variantToCategory.set(v.id, catName);
    }
  } catch { }

  const engineCart = {
    currency: "BRL" as const,
    total: contextItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) / 100,
    items: contextItems.map((i) => {
      const variantId = i.variantId;
      return {
        sku: i.sku ?? variantToSku.get(variantId) ?? variantId,
        name: i.name,
        price: i.unitPriceCents / 100,
        quantity: i.quantity,
        category: variantToCategory.get(variantId),
      };
    }),
    source: "storefront" as const,
  };

  if (deps.listEligibleCrossSells) {
    const suggestions = await deps.listEligibleCrossSells.execute({
      session_id: cart.sessionId || `sf_${Date.now()}`,
      merchant_id: merchantId,
      cart: engineCart,
      enabled_strategies: strategies,
    });

    if (suggestions.length > 0) {
      // Bounded exact lookups, never a first-page catalog scan or an arbitrary
      // variant substitution. SKU uniqueness is not guaranteed across products.
      const seen = new Set<string>();
      let reads = 0;
      for (const suggestion of suggestions) {
        if (crossSellSuggestions.length >= maxSuggestions) break;
        // A legacy percentage is eligibility evidence only. A real discount must
        // be backed by the connected cart quote, never by that percentage alone.
        const needsDiscountQuote = suggestion.computed_discount !== 0;
        if (needsDiscountQuote && !deps.crossSellCart?.quote) continue;
        for (const sku of suggestion.ranked_items) {
          if (crossSellSuggestions.length >= maxSuggestions) break;
          if (reads >= 20) break;
          if (typeof sku !== "string" || !sku.trim() || sku.length > 191 || seen.has(sku.toLowerCase())) continue;
          seen.add(sku.toLowerCase()); reads++;
          try {
            const matches = await deps.prisma.productVariant.findMany({
              where: { isActive: true, product: { merchantId, isActive: true, deletedAt: null },
                OR: [{ id: sku }, { sku: { equals: sku, mode: "insensitive" } }] },
              select: { id: true, productId: true }, orderBy: { id: "asc" }, take: 2,
            });
            if (matches.length !== 1) continue;
            const match = matches[0];
            if (cartVariantIds.includes(match.id) || crossSellSuggestions.some(s => s.sku === match.id)) continue;
            const p = await deps.productRepo.findById(merchantId, match.productId);
            const variant = p?.variants.find(v => v.id === match.id && (v.id === sku || v.sku.toLowerCase() === sku.toLowerCase()));
            if (!p || p.merchantId !== merchantId || !p.isActive || !variant?.isActive || p.name === productName) continue;
            if (p.type !== "digital" && p.type !== "service" && !(variant.stockQuantity - variant.stockReserved > 0)) continue;
            if (needsDiscountQuote) {
              const quote = await deps.crossSellCart!.quote!({ merchantId, cartId: cart.sessionId }, {
                variantId: variant.id, promotionId: suggestion.promo_id, quantity: 1 });
              if (quote.merchantId !== merchantId || quote.cartId !== cart.sessionId || quote.variantId !== variant.id
                || quote.productId !== p.id || quote.promotionId !== suggestion.promo_id
                || quote.maximumUnitPriceCents >= quote.originalUnitPriceCents) continue;
              crossSellSuggestions.push({ name: p.name, sku: variant.id, productId: p.id,
                price: quote.maximumUnitPriceCents / 100, imageUrl: variant.media?.[0]?.url,
                promoId: quote.promotionId, discountPercent: (quote.originalUnitPriceCents - quote.maximumUnitPriceCents) / quote.originalUnitPriceCents * 100 });
              continue;
            }
            // Reuse the same one-item price authority as product discovery.
            // This read has no cart/coupon/stock writer and quotes this variant only.
            const quote = createShoppingRecommendationReader(deps as ProductHandlerDeps, { merchantId, sessionId: cart.sessionId }, async () => ({
              products: [{ id: p.id, name: p.name, type: p.type, price: variant.basePriceInCents, inStock: true,
                variants: [{ id: variant.id, sku: variant.sku, attributes: variant.attributes, basePriceInCents: variant.basePriceInCents,
                  isActive: variant.isActive, stockQuantity: variant.stockQuantity, stockReserved: variant.stockReserved }] }],
            }));
            const quoted = storefrontToolOutputSchemas.search_products.parse(await quote({ criteria: { version: 1, query: "*", attributes: [], unsupportedCriteria: [] }, limit: 1 }));
            const price = quoted.products?.[0]?.variants?.find(v => v.id === variant.id)?.price;
            if (!Number.isSafeInteger(price) || price! <= 0) continue;
            crossSellSuggestions.push({
              name: p.name,
              sku: variant.id,
              productId: p.id,
              price: price! / 100,
              recommendationRuleId: suggestion.promo_id || undefined,
              imageUrl: variant.media?.[0]?.url,
            });
          } catch { /* A recommendation failure never retries the successful add. */ }
        }
      }
    }
  }

  return crossSellSuggestions;
}
