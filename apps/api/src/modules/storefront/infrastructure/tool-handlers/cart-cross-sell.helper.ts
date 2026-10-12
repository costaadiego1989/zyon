import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import type { PrismaClient } from "@prisma/client";
import { normalizeCrossSellStrategies } from "@zyon/shared-types";

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
  price: number;
  imageUrl?: string;
  discountPercent?: number;
  couponCode?: string;
  promoId?: string;
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
  listEligibleCrossSells?: ListEligibleCrossSellsUseCase;
}

export async function buildCrossSellSuggestions(
  deps: BuildCrossSellDeps,
  merchantId: string,
  cart: CartSnapshot,
  crossSellConfig: CrossSellConfig,
  productName: string,
  referenceItem?: CartLineItem,
): Promise<CrossSellSuggestion[]> {
  let crossSellSuggestions: CrossSellSuggestion[] = [];
  const maxSuggestions = crossSellConfig.limits.maxSuggestionsPerSession ?? 3;
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
      const catalogResults = await deps.productRepo.search({ merchantId, limit: 100, isActiveOnly: true });
      const skuToProduct = new Map<string, (typeof catalogResults.products)[number]>();
      for (const p of catalogResults.products) {
        const commercialSku = p.variants?.[0]?.sku;
        if (commercialSku) skuToProduct.set(commercialSku.toLowerCase(), p);
        skuToProduct.set(p.id.toLowerCase(), p);
      }

      for (const suggestion of suggestions) {
        if (crossSellSuggestions.length >= maxSuggestions) break;
        for (const sku of suggestion.ranked_items) {
          if (crossSellSuggestions.length >= maxSuggestions) break;
          const p = skuToProduct.get(sku.toLowerCase());
          if (p && p.name !== productName && p.hasStock && !p.variants.some((v) => cartVariantIds.includes(v.id)) && !crossSellSuggestions.some((s) => s.sku === p.variants[0]?.id)) {
            crossSellSuggestions.push({
              name: p.name,
              sku: p.variants?.[0]?.id ?? p.id,
              price: (p.variants?.[0]?.basePriceInCents ?? 0) / 100,
              imageUrl: p.variants?.[0]?.media?.[0]?.url,
              discountPercent: suggestion.computed_discount > 0 ? suggestion.computed_discount : undefined,
              promoId: suggestion.promo_id || undefined,
              couponCode: crossSellConfig.discount.enabled && crossSellConfig.discount.mode === "coupon" ? crossSellConfig.discount.couponCode : undefined,
            });
          }
        }
      }
    }
  }

  return crossSellSuggestions;
}
