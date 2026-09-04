import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import type { PrismaClient } from "@prisma/client";

export interface CrossSellConfig {
  enabled: boolean;
  touchpoints: { browsing: boolean; pre_cart: boolean; pre_payment: boolean; post_purchase: boolean };
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
): Promise<CrossSellSuggestion[]> {
  let crossSellSuggestions: CrossSellSuggestion[] = [];
  const maxSuggestions = crossSellConfig.limits.maxSuggestionsPerSession ?? 3;
  const cartVariantIds = cart.items.map((i) => i.sku ?? i.variantId);
  const variantToSku = new Map<string, string>();
  const variantToCategory = new Map<string, string>();
  try {
    const variants = await deps.prisma.productVariant.findMany({
      where: { id: { in: cartVariantIds } },
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
    total: cart.total / 100,
    items: cart.items.map((i) => {
      const variantId = i.sku ?? i.variantId;
      return {
        sku: variantToSku.get(variantId) ?? variantId,
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
      enabled_strategies: crossSellConfig.strategies as import("@zyon/shared-types").CrossSellStrategy[],
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
          if (p && p.name !== productName) {
            crossSellSuggestions.push({
              name: p.name,
              sku: p.variants?.[0]?.sku ?? p.id,
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

  if (crossSellSuggestions.length === 0) {
    const products = await deps.productRepo.search({ merchantId, limit: 10, isActiveOnly: true });
    crossSellSuggestions = products.products
      .filter((p) => p.name !== productName && p.hasStock)
      .slice(0, maxSuggestions)
      .map((p) => ({
        name: p.name,
        sku: p.variants[0]?.sku ?? p.id,
        price: (p.variants[0]?.basePriceInCents ?? 0) / 100,
        imageUrl: p.variants[0]?.media?.[0]?.url,
        discountPercent: crossSellConfig.discount.enabled && crossSellConfig.discount.mode !== "coupon" ? crossSellConfig.discount.percent : undefined,
        couponCode: crossSellConfig.discount.enabled && crossSellConfig.discount.mode === "coupon" ? crossSellConfig.discount.couponCode : undefined,
      }));
  }

  return crossSellSuggestions;
}
