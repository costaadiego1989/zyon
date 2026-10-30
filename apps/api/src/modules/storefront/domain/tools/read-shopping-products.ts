import { shoppingSearchPlanSchema, type ShoppingSearchPlan } from "../contracts/shopping-search-plan.schemas.js";
import { StorefrontToolOutputError } from "../contracts/storefront-tool-output.schemas.js";
import type { StoreToolHandlers } from "./types.js";

/** Commercial evidence requirements do not depend on a provider's intent label.
 * Native tools and UI shortcuts share the same read admission. */
export function requiresCanonicalShoppingRead(plan: ShoppingSearchPlan): boolean {
  return plan.discountOnly === true || plan.minPriceCents !== undefined || plan.maxPriceCents !== undefined
    || plan.recovery !== undefined || plan.attributes.some(a => a.priority === "preferred" && a.operator === "equals");
}

export async function readShoppingProducts(handlers: StoreToolHandlers, args: Parameters<StoreToolHandlers["searchProducts"]>[0]): Promise<unknown> {
  if (args.criteria === undefined) return handlers.searchProducts(args);
  const parsed = shoppingSearchPlanSchema.safeParse(args.criteria);
  if (!parsed.success) throw new StorefrontToolOutputError();
  const plan = parsed.data;
  if (handlers.shoppingReadMode === "lookup_only") {
    if (plan.discountOnly === true) throw new StorefrontToolOutputError();
    // A server-admitted auxiliary lookup resolves a name. Ratings, money and
    // preferences generated for a review are not shopping requirements here.
    return handlers.searchProducts({ ...args, criteria: plan, lookupOnly: true });
  }
  if (args.sortBy === "discount" || args.sortBy === "best_sellers") {
    return { products: [], nextCursor: null, query: plan.query, searchEvidence: { version: 1, status: "unsupported",
      appliedPlan: plan, unconfirmedPreferences: [], message: args.sortBy === "discount"
        ? "🔎 A ordenação por maior desconto ainda não está disponível. Posso consultar produtos com promoção vigente sem afirmar esse ranking."
        : "🔎 A ordenação por mais vendidos ainda não está disponível. Posso consultar os produtos sem afirmar esse ranking." } };
  }
  if (!(plan.discountOnly === true || !args.lookupOnly && requiresCanonicalShoppingRead(plan)))
    return handlers.searchProducts({ ...args, criteria: plan });
  if (!handlers.recommendProducts) throw new StorefrontToolOutputError();
  try {
    return await handlers.recommendProducts({ criteria: plan, limit: args.limit,
      ...(args.categoryId === undefined ? {} : { categoryId: args.categoryId }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }) });
  } catch { throw new StorefrontToolOutputError(); } // Read failure is not absence; never fall back to base-price search.
}
