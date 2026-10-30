import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";

type ProductDetail = ReturnType<typeof storefrontToolOutputSchemas.get_product_details.parse>["product"];

/** A current read may project its proven price onto the matching detail card.
 * It never changes the catalog basis, grants a coupon, or prices another SKU. */
export function currentDealCardPricing(product: ProductDetail, rawDeals: unknown, now = Date.now()) {
  const parsed = storefrontToolOutputSchemas.get_daily_deals.safeParse(rawDeals);
  const deals = parsed.success && product.source !== "marketplace" ? parsed.data.deals : [];
  const matched = new Map<string, (typeof deals)[number]>();
  const variants = (product.variants ?? []).filter(variant => variant.isActive !== false).map(variant => {
    const base = variant.basePriceInCents;
    if (!Number.isSafeInteger(base) || base! <= 0 || variant.price !== undefined) return variant;
    const eligible = deals.filter(deal => deal.id === product.id && deal.variantId === variant.id
      && deal.inStock === true && !deal.coupon && Number.isSafeInteger(deal.price)
      && deal.price < base! && deal.originalPrice === base && !!deal.expiresAt
      && Date.parse(deal.expiresAt) > now);
    if (eligible.length !== 1) return variant;
    matched.set(variant.id, eligible[0]!);
    return { ...variant, price: eligible[0]!.price };
  });
  return { variants, firstDeal: variants[0] ? matched.get(variants[0].id) : undefined };
}
