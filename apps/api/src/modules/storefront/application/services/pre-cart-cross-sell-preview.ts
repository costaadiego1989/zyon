export type PublicCrossSellProduct = {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  image?: string;
  inStock: boolean;
  discountPercent?: number;
  promoId?: string;
};

export type PublicCrossSellPreview = {
  trigger: string;
  displayMode: string;
  products: PublicCrossSellProduct[];
};

export type PreCartCrossSellInput = {
  config: unknown;
  viewedSkus: string[];
  viewedCategory?: string | null;
  promotions: Array<{
    id: string;
    trigger: unknown;
    recommendedSkus: string[];
    discountPercent: unknown;
  }>;
  products: Array<{
    id: string;
    sku: string;
    name: string;
    price: number;
    image?: string;
    inStock: boolean;
  }>;
};

const VALID_STRATEGIES = new Set([
  "same_category",
  "bought_together",
  "complementary",
  "cart_value_upgrade",
  "ai_personalized",
]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value && "toNumber" in value && typeof (value as { toNumber?: unknown }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function configForPreview(value: unknown) {
  const config = asObject(value);
  const touchpoints = asObject(config.touchpoints);
  const limits = asObject(config.limits);
  const display = asObject(config.display);
  const enabled = config.enabled === true && touchpoints.pre_cart === true;
  const strategies = strings(config.strategies).filter((strategy) => VALID_STRATEGIES.has(strategy));
  const maxSuggestions = Math.max(0, Math.min(6, Math.trunc(numberValue(limits.maxSuggestionsPerSession) || 2)));
  return {
    enabled,
    strategies,
    maxSuggestions,
    displayMode: typeof display.mode === "string" ? display.mode : "inline",
  };
}

function promotionMatches(
  triggerValue: unknown,
  strategies: string[],
  viewedSkus: Set<string>,
  viewedCategory?: string | null,
): boolean {
  const trigger = asObject(triggerValue);
  const triggerSkus = new Set(strings(trigger.sku_in_cart).map((sku) => sku.toLowerCase()));
  const triggerCategories = new Set(strings(trigger.category_in_cart).map((category) => category.toLowerCase()));
  const hasSkuMatch = [...viewedSkus].some((sku) => triggerSkus.has(sku));
  const normalizedCategory = viewedCategory?.toLowerCase();
  const hasCategoryMatch = normalizedCategory !== undefined && triggerCategories.has(normalizedCategory);

  return (
    (hasSkuMatch && (strategies.includes("bought_together") || strategies.includes("complementary"))) ||
    (hasCategoryMatch && strategies.includes("same_category")) ||
    // A manually configured promotion is also the authorization for a
    // personalized offer. The cart still verifies the recommended SKU and
    // promotion before it applies a discount.
    (hasSkuMatch && strategies.includes("ai_personalized"))
  );
}

/**
 * Builds a public, non-persistent pre-cart offer for a rich product page.
 * Reading a product must not create a cart, a cross-sell suggestion record or
 * an outbox event. The acceptance path validates the promotion again.
 */
export function buildPreCartCrossSellPreview(input: PreCartCrossSellInput): PublicCrossSellPreview | undefined {
  const config = configForPreview(input.config);
  if (!config.enabled || config.maxSuggestions === 0 || config.strategies.length === 0) return undefined;

  const viewedSkus = new Set(input.viewedSkus.map((sku) => sku.toLowerCase()));
  if (viewedSkus.size === 0) return undefined;

  const productsBySku = new Map(input.products.map((product) => [product.sku.toLowerCase(), product]));
  const seen = new Set<string>();
  const products: PublicCrossSellProduct[] = [];

  const matchingPromotions = input.promotions
    .filter((promotion) => promotionMatches(promotion.trigger, config.strategies, viewedSkus, input.viewedCategory))
    .sort((left, right) => numberValue(right.discountPercent) - numberValue(left.discountPercent));

  for (const promotion of matchingPromotions) {
    for (const sku of promotion.recommendedSkus) {
      if (products.length >= config.maxSuggestions) break;
      const candidate = productsBySku.get(sku.toLowerCase());
      if (!candidate || !candidate.inStock || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      const discountPercent = Math.max(0, numberValue(promotion.discountPercent));
      products.push({
        id: candidate.id,
        name: candidate.name,
        price: candidate.price,
        priceFormatted: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(candidate.price),
        image: candidate.image,
        inStock: true,
        ...(discountPercent > 0 ? { discountPercent } : {}),
        promoId: promotion.id,
      });
    }
    if (products.length >= config.maxSuggestions) break;
  }

  return products.length > 0
    ? { trigger: "Complementos para este produto", displayMode: config.displayMode, products }
    : undefined;
}
