import type { ProductHandlerDeps } from "./product.handlers.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { shoppingSearchPlanSchema } from "../../domain/contracts/shopping-search-plan.schemas.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { shoppingSearchEvidence, shoppingRecoveryEvidence } from "../../application/services/shopping-search-evidence.js";
import { normalizeShoppingFact, shoppingRecoveryQueries, shoppingFamilyMatches, shoppingAttributesMatch } from "../../domain/services/shopping-recovery.js";
import { loadCartCosts } from "../../application/services/reevaluate-cart-rules.js";
import { applyProductPromoPricing } from "../../application/services/storefront-cart-promo.pricing.js";
import { readExistingMerchantRules } from "../../../merchant/application/services/read-existing-merchant-rules.js";

/** Independent one-item quotes: alternatives are never priced together as an
 * imaginary cart. No cart repository, coupon application or stock write exists. */
export function createShoppingRecommendationReader(deps: ProductHandlerDeps, ctx: ToolRequestContext,
  search: StoreToolHandlers["searchProducts"]): NonNullable<StoreToolHandlers["recommendProducts"]> {
  return async args => {
    const plan = shoppingSearchPlanSchema.parse(args.criteria);
    if (plan.delivery || plan.unsupportedCriteria.length) return { products: [], nextCursor: null,
      query: plan.query, searchEvidence: shoppingSearchEvidence(plan, 0) };
    const rules = await readExistingMerchantRules(deps.merchantRepo, ctx.merchantId);
    if (!rules) throw new Error("shopping_price_authority_unavailable");
    const now = new Date();
    const promotions = await deps.prisma.productPromotion.findMany({
      where: { merchantId: ctx.merchantId, isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { id: true, merchantId: true, productId: true, variantId: true, categoryId: true, couponId: true,
        discountType: true, discountValue: true, promoPriceInCents: true, isActive: true, startsAt: true, endsAt: true,
        createdAt: true, updatedAt: true },
    });
    const { minPriceCents: _min, maxPriceCents: _max, sortBy, recovery: _recovery, ...criteria } = plan;
    const candidatePlan = { ...criteria, ...(sortBy && sortBy !== "price_asc" && sortBy !== "price_desc" ? { sortBy } : {}) };
    type Product = ReturnType<typeof storefrontToolOutputSchemas.search_products.parse>["products"][number];
    const recoveryPlan = plan.recovery ? plan : plan.attributes.some(a => a.priority === "preferred" && a.operator === "equals")
      ? { ...plan, recovery: { familyQuery: plan.query, optionalQueryTerms: [] } } : undefined;
    const queries = recoveryPlan && shoppingRecoveryQueries(recoveryPlan, ctx.userMessage);
    if (plan.recovery && !queries && plan.recovery.optionalQueryTerms.some(term =>
      !(` ${normalizeShoppingFact(plan.query)} `).includes(` ${normalizeShoppingFact(term)} `)))
      throw new Error("shopping_recovery_scope_unconfirmed");
    const phases = [{ query: queries?.exact ?? plan.query, similar: false }, ...(queries ? [{ query: queries.family, similar: true }] : [])];
    let products = new Map<string, Product>();
    let truncated = false, unconfirmedPrice = false, readCount = 0, quoteCount = 0, similar = false;
    // Both phases share three catalog pages. Only a complete, zero eligible
    // exact result permits recovery; errors and unknown prices never do.
    for (const phase of phases) {
      const seenCursors = new Set<string>();
      let cursor: string | undefined, complete = false;
      products = new Map();
      const phasePlan = { ...candidatePlan, query: phase.query, attributes: candidatePlan.attributes.map(a => ({ ...a,
        priority: (a.operator === "not_equals" || !phase.similar && recoveryPlan ? "required" : a.priority) as "required" | "preferred" })) };
      while (readCount < 3) {
        readCount++;
        const result = storefrontToolOutputSchemas.search_products.parse(await search({ query: phase.query,
          criteria: phasePlan, inStockOnly: true, limit: 20, ...(cursor ? { cursor } : {}) }));
        for (const product of result.products) {
          if (product.inStock !== true || product.source === "marketplace") continue;
          if (plan.minRating !== undefined && (product.rating === undefined || product.rating === null || product.rating < plan.minRating)) continue;
          if (recoveryPlan && !shoppingFamilyMatches(phase.query, `${product.name} ${product.description ?? ""}`)) continue;
          const eligible = [];
          if ((product.variants?.length ?? 0) > 20) truncated = true;
          for (const variant of (product.variants ?? []).slice(0, 20)) {
            const base = variant.basePriceInCents;
            if (variant.isActive === false || !Number.isSafeInteger(base) || base! < 0) continue;
            if (recoveryPlan && !shoppingAttributesMatch(plan, variant.attributes, !phase.similar)) continue;
            if (product.type !== "digital" && product.type !== "service"
              && (variant.stockQuantity ?? 0) <= (variant.stockReserved ?? 0)) continue;
            if (recoveryPlan && quoteCount >= 60) { truncated = true; continue; }
            quoteCount++;
            try {
              const quote: StorefrontCart = { id: `shopping-read:${product.id}:${variant.id}`, merchantId: ctx.merchantId,
                sessionId: ctx.sessionId, items: [{ productId: product.id, variantId: variant.id, sku: variant.sku ?? variant.id,
                  name: product.name, quantity: 1, unitPriceCents: base! }], total: base!, discount: 0, couponCode: null,
                freeShipping: false, createdAt: now, updatedAt: now };
              // Verifies original price, tenant, product and option requirements;
              // the selector then applies the same ceiling and margin as checkout.
              const costs = await loadCartCosts(deps.prisma, ctx.merchantId, quote, true);
              if (quote.items[0]!.pricingOriginalUnitPriceCents !== base) throw new Error("shopping_catalog_price_changed");
              const meta = await applyProductPromoPricing({ findActiveBySku: async () => promotions }, ctx.merchantId, quote,
                { rules, costsByVariant: costs });
              const price = quote.items[0]!.unitPriceCents;
              if (plan.minPriceCents !== undefined && price < plan.minPriceCents
                || plan.maxPriceCents !== undefined && price > plan.maxPriceCents) continue;
              eligible.push({ variant: { ...variant, price }, badge: meta.get(variant.id) });
            } catch {
              // A required option or a stale price in one variant cannot grant
              // it eligibility or erase other independently confirmed products.
              unconfirmedPrice = true;
            }
          }
          eligible.sort((a, b) => a.variant.price - b.variant.price || a.variant.id.localeCompare(b.variant.id));
          const first = eligible[0];
          if (first) products.set(product.id, { ...product, price: first.variant.price, variants: eligible.map(item => item.variant),
            ...(first.badge && !first.badge.coupon ? { originalPrice: first.badge.originalPriceCents,
              discountPercent: first.badge.discountPercent } : {}) });
        }
        const next = result.nextCursor;
        if (!next) { complete = true; break; }
        if (seenCursors.has(next)) throw new Error("shopping_cursor_inconsistent");
        seenCursors.add(next); cursor = next;
      }
      truncated ||= !complete;
      similar = phase.similar;
      if (products.size || !complete || truncated || unconfirmedPrice) break;
    }
    const matches = [...products.values()];
    if (plan.sortBy === "price_asc" || plan.sortBy === "price_desc") matches.sort((a, b) =>
      (plan.sortBy === "price_desc" ? -1 : 1) * (a.price! - b.price!) || a.id.localeCompare(b.id));
    else if (plan.sortBy === "rating") matches.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.id.localeCompare(b.id));
    const limit = Math.min(Math.max(args.limit ?? 3, 1), recoveryPlan ? 3 : 20);
    const selected = matches.slice(0, limit);
    if (!selected.length && unconfirmedPrice) throw new Error("shopping_price_authority_unavailable");
    const evidence = recoveryPlan ? shoppingRecoveryEvidence(recoveryPlan, selected, selected.length ? similar ? "similar" : "exact"
      : truncated ? "incomplete" : "no_match") : shoppingSearchEvidence(plan, selected.length);
    evidence.appliedPlan = plan;
    if (!recoveryPlan && truncated && !selected.length) evidence.message = "🔎 Não encontrei uma opção compatível entre os produtos verificados nesta seleção. Podemos refinar a busca?";
    if (truncated || matches.length > limit) evidence.message += "\nℹ️ Esta é uma seleção das opções verificadas, não uma listagem completa. Podemos refinar a busca.";
    if (unconfirmedPrice) evidence.message += "\nℹ️ Algumas condições não puderam ser verificadas. Apresentei somente opções com preço confirmado.";
    return { products: selected, nextCursor: null, query: plan.query, searchEvidence: evidence };
  };
}
