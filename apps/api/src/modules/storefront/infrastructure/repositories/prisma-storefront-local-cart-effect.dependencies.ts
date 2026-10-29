import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { StorefrontLocalCartEffectDependencies } from "./prisma-storefront-local-cart-effect.executor.js";
import { storefrontWriteScopeSchema, storefrontLocalCartWriteIntentSchema } from "../../domain/contracts/storefront-local-cart-write.schemas.js";
import { storefrontResolvedLocalCartItemSchema, storefrontLocalCartCommercialOutcomeV1Schema, storefrontSelectedOptionsSchema,
  storefrontOptionItemIdsSchema, storefrontOptionLineIdentity } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { CartRulesEngine, buildCartRuleContext, toEngineCart } from "../../domain/services/cart-rules-engine.service.js";
import { selectBestProductPromotion, allocatePromotionDiscountBudget } from "../../../catalog/domain/services/best-product-promotion.service.js";
import { evaluateCombinedDiscount } from "@zyon/rules-engine";
import { commercialNotice } from "../../domain/services/commercial-notice.js";
import type { CommercialNotice } from "@zyon/shared-types";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { validateFoodMetadata, foodSelectionLimits } from "../../../catalog/domain/services/food-options-validation.js";
import { extractOptionGroups, resolveSelectedOptions, FoodOptionValidationError } from "../../domain/food-options.js";
import { crossSellAcceptedLineIntentSchema } from "../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import { buildCrossSellQuoteCandidate } from "../../../cross-sell/domain/services/cross-sell-quote-candidate.js";
import { evaluateLegacySavedPriceBasis } from "../../domain/services/storefront-legacy-saved-price.js";
import { LegacySavedPriceReviewRequired } from "../../application/services/legacy-saved-price-review.js";

const id = storefrontWriteScopeSchema.shape.cartId;
const cents = z.number().int().min(0).max(2_147_483_647);
const name = z.string().min(1).max(1000);
const sku = z.string().min(1).max(191);
const productSchema = z.strictObject({
  id, merchantId: id, name, type: z.literal("physical"),
  metadata: z.unknown().refine(value => value !== undefined),
  isActive: z.literal(true), deletedAt: z.null(), categoryId: id.nullable(),
});
const catalogSchema = z.strictObject({
  id, sku, isActive: z.literal(true), product: productSchema,
  // Analytic cost is deliberately outside the commercial validation shape.
  price: z.object({ variantId: id, currency: z.literal("BRL"), basePriceInCents: cents }).nullable(),
});
const catalogSelect = {
  id: true, sku: true, isActive: true,
  product: { select: { id: true, merchantId: true, name: true, type: true, metadata: true,
    isActive: true, deletedAt: true, categoryId: true } },
  price: { select: { variantId: true, currency: true, basePriceInCents: true } },
} as const satisfies Prisma.ProductVariantSelect;
const catalogWithAnalyticsSelect = { ...catalogSelect,
  price: { select: { ...catalogSelect.price.select, costInCents: true } },
} as const satisfies Prisma.ProductVariantSelect;
const cartSchema = z.strictObject({
  id, merchantId: id, sessionId: id,
  items: z.array(z.strictObject({ variantId: id, productId: id, categoryId: id.optional(), name, sku,
    quantity: z.number().int().min(1).max(99), unitPriceCents: cents,
    imageUrl: z.string().min(1).max(2048).optional(), selectedOptions: storefrontSelectedOptionsSchema.optional(),
    crossSellIntent: crossSellAcceptedLineIntentSchema.optional(),
  })).min(1).max(200),
  couponCode: z.null(), discount: cents, freeShipping: z.boolean(), total: cents,
  createdAt: z.date(), updatedAt: z.date(), expiresAt: z.date().optional(),
});
const decimal = z.custom<Prisma.Decimal>(value => Prisma.Decimal.isDecimal(value))
  .transform(value => value.toNumber()).pipe(z.number().finite().nonnegative());
const percentDecimal = decimal.pipe(z.number().max(100));
const merchantSchema = z.strictObject({
  merchantId: id, maxDiscountPercent: percentDecimal,
  allowFreeShipping: z.boolean(), allowShippingDiscount: z.boolean(), allowBonusItem: z.boolean(),
  allowStackDiscountAndFreeShipping: z.boolean(), couponBoxEnabled: z.boolean(), autonomousEngineEnabled: z.boolean(),
  freeShippingMinCartValue: decimal, maxShippingSubsidy: decimal, maxPartialShippingDiscount: decimal,
  offerExpirationMinutes: z.number().int().nonnegative(), blockedRegions: z.array(z.string()),
  brandVoice: z.enum(["consultative", "aggressive", "premium", "young", "technical", "popular"]),
});
const merchantSelect = {
  merchantId: true, maxDiscountPercent: true, allowFreeShipping: true,
  allowShippingDiscount: true, allowBonusItem: true, allowStackDiscountAndFreeShipping: true,
  couponBoxEnabled: true, autonomousEngineEnabled: true, freeShippingMinCartValue: true,
  maxShippingSubsidy: true, maxPartialShippingDiscount: true, offerExpirationMinutes: true,
  blockedRegions: true, brandVoice: true,
} as const satisfies Prisma.MerchantRuleSelect;
const numericParam = z.union([z.number().finite(), z.string().trim().min(1).refine(value => Number.isFinite(Number(value)))])
  .transform(value => Number(value));
const ruleSchema = z.object({
  id: id.optional(), productId: id.optional(), enabled: z.boolean(), priority: z.number().finite(),
  conditions: z.array(z.object({
    field: z.enum(["cart_total", "shipping_cost", "cart_item_count", "product_in_cart", "category_in_cart",
      "coupon_applied", "buyer_type", "payment_method", "trigger_fired"]),
    operator: z.string().transform(value => value.trim().toLowerCase()).pipe(z.enum([
      "gt", "lt", "gte", "lte", "eq", "contains", "is", ">", "<", ">=", "<=", "=", "==", "===",
    ])),
    value: z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())]),
  }).superRefine((condition, ctx) => {
    const numericField = ["cart_total", "shipping_cost", "cart_item_count"].includes(condition.field);
    const numericOperator = ["gt", "lt", "gte", "lte", ">", "<", ">=", "<="].includes(condition.operator);
    if ((numericField && (!numericParam.safeParse(condition.value).success || condition.operator === "contains"))
      || (!numericField && numericOperator)) {
      ctx.addIssue({ code: "custom", message: "storefront_effect_condition_policy_invalid" });
    }
  })).min(1),
  action: z.object({
    type: z.enum(["offer_discount", "offer_free_shipping", "offer_coupon", "show_message", "suggest_product", "do_nothing", "offer_installments"]),
    params: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])),
  }),
}).superRefine((rule, ctx) => {
  if (rule.action.type !== "offer_discount") return;
  if (!numericParam.pipe(z.number().min(0).max(100)).safeParse(rule.action.params.percent).success
    || (rule.action.params.maxDiscountReais !== undefined
      && !numericParam.pipe(z.number().nonnegative()).safeParse(rule.action.params.maxDiscountReais).success)) {
    ctx.addIssue({ code: "custom", message: "storefront_effect_discount_policy_invalid", path: ["action", "params"] });
  }
});
const settingSchema = z.strictObject({ merchantId: id, advancedRules: z.array(ruleSchema).max(20).nullable() });

function assertCatalog(row: z.infer<typeof catalogSchema>, merchantId: string): void {
  if (row.product.merchantId !== merchantId || row.price === null || row.price.variantId !== row.id
    || validateFoodMetadata(row.product.metadata)) {
    throw new Error("storefront_effect_catalog_authority_invalid");
  }
}

/** Reconstruct the full unit price from current tenant-owned metadata, never a
 * remembered client modifier. Metadata is held by the existing product fence. */
function canonicalOptions(row: z.infer<typeof catalogSchema>, requestedIds: readonly string[] = []) {
  const ids = storefrontOptionItemIdsSchema.parse(requestedIds);
  let result;
  try { result = resolveSelectedOptions(extractOptionGroups(row.product.metadata), ids); }
  catch (error) { if (error instanceof FoodOptionValidationError) throw new Error("storefront_effect_catalog_authority_invalid"); throw error; }
  const selected = storefrontSelectedOptionsSchema.parse(result.selected).sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0);
  const rawGroups = (row.product.metadata as { optionGroups?: Array<{ id: string; items: unknown[]; required?: boolean; selectionType?: string; minSelections?: number; maxSelections?: number }> } | null)?.optionGroups ?? [];
  for (const group of rawGroups) {
    const count = selected.filter(option => option.groupId === group.id).length, limits = foodSelectionLimits(group);
    if (count < limits.min || count > limits.max) throw new Error("storefront_effect_catalog_authority_invalid");
  }
  const modifier = cents.parse(result.priceModifierInCents), price = cents.parse(row.price!.basePriceInCents + modifier);
  return { selected, modifier, price };
}

const promotionSchema = z.strictObject({ id, merchantId: id, productId: id.nullable(), variantId: id.nullable(), categoryId: id.nullable(),
  couponId: id.nullable(), discountType: z.string().nullable(), discountValue: z.number().finite().nullable(),
  promoPriceInCents: cents.nullable(), isActive: z.boolean(), startsAt: z.date(), endsAt: z.date() });
const promotionSelect = { id: true, merchantId: true, productId: true, variantId: true, categoryId: true, couponId: true,
  discountType: true, discountValue: true, promoPriceInCents: true, isActive: true, startsAt: true, endsAt: true } as const satisfies Prisma.ProductPromotionSelect;
const crossPromotionSchema = z.strictObject({ id, merchantId: id, updatedAt: z.date(), status: z.enum(["active", "archived"]),
  startsAt: z.date(), endsAt: z.date().nullable(), recommendedSkus: z.array(sku).min(1).max(200),
  discountPercent: z.custom<Prisma.Decimal>(value => Prisma.Decimal.isDecimal(value)),
  maxDiscountPercent: z.custom<Prisma.Decimal>(value => Prisma.Decimal.isDecimal(value)),
  trigger: z.strictObject({ sku_in_cart: z.array(sku).min(1).max(200).optional(),
    category_in_cart: z.array(id).min(1).max(200).optional(),
    cart_total_above: z.number().finite().nonnegative().refine(value => Number.isSafeInteger(value * 100)).optional() }),
});
export const storefrontCrossPromotionSelect = { id: true, merchantId: true, updatedAt: true, status: true, startsAt: true, endsAt: true,
  recommendedSkus: true, discountPercent: true, maxDiscountPercent: true, trigger: true } as const satisfies Prisma.CrossSellPromotionSelect;

export async function resolveStorefrontCartCatalogItem(tx: Prisma.TransactionClient, merchantId: string, variantId: string, selectedOptionItemIds: readonly string[] = []) {
  id.parse(merchantId); id.parse(variantId);
  const row = catalogSchema.parse(await tx.productVariant.findFirst({
    where: { id: variantId, isActive: true, product: { merchantId, isActive: true, deletedAt: null } }, select: catalogSelect,
  }));
  if (row.id !== variantId) throw new Error("storefront_effect_catalog_authority_invalid");
  assertCatalog(row, merchantId);
  const options = canonicalOptions(row, selectedOptionItemIds);
  const resolved = storefrontResolvedLocalCartItemSchema.parse({ productId: row.product.id, name: row.product.name,
    sku: row.sku, unitPriceCents: options.price,
    ...(row.product.categoryId === null ? {} : { categoryId: row.product.categoryId }),
  });
  return { ...resolved, ...(options.selected.length ? { selectedOptions: options.selected } : {}) };
}

/** Isolated base-price candidate with transient commercial V1 quotation. Uses only the supplied transaction; never
 * owns a client, writes policy defaults, catches failed authority, or retries.
 * Shared tx is NOT exclusion against concurrent catalog/policy administration. */
export function createPrismaStorefrontLocalCartEffectDependencies(): StorefrontLocalCartEffectDependencies {
  return Object.freeze({
    resolveItem: async (tx, rawScope, rawIntent) => {
      const scope = storefrontWriteScopeSchema.parse(rawScope);
      const intent = storefrontLocalCartWriteIntentSchema.parse(rawIntent);
      return resolveStorefrontCartCatalogItem(tx, scope.merchantId, intent.command.args.variantId);
    },
    evaluateRules: async (tx, rawScope, rawCart) => evaluateStorefrontCartCommercial(tx, storefrontWriteScopeSchema.parse(rawScope), rawCart),
  } satisfies StorefrontLocalCartEffectDependencies);
}

/** Shared transaction-bound authority for persisted local carts. No fabricated
 * conversation/principal is necessary and no cart write/client/transaction is opened. */
export async function evaluateStorefrontCartCommercial(tx: Prisma.TransactionClient,
  rawScope: { merchantId: string; cartId: string }, rawCart: StorefrontCart) {
  return (await readStorefrontCartCommercial(tx, rawScope, rawCart)).outcome;
}

/** Internal checkout reader also carries current costs. Never serialize this
 * internal result as a public quote/cart; project() deliberately omits the map. */
export async function readStorefrontCartCommercial(tx: Prisma.TransactionClient,
  rawScope: { merchantId: string; cartId: string }, rawCart: StorefrontCart, observedAt?: Date, includeCostAnalytics = true) {
      const suppliedClock = observedAt === undefined ? undefined : new Date(observedAt.getTime());
      if (suppliedClock && !Number.isFinite(suppliedClock.getTime())) throw new Error("storefront_effect_commercial_authority_invalid");
      const scope = z.strictObject({ merchantId: id, cartId: id }).parse({ merchantId: rawScope.merchantId, cartId: rawScope.cartId });
      const cart: StorefrontCart = cartSchema.parse(rawCart);
      if (cart.merchantId !== scope.merchantId || cart.sessionId !== scope.cartId) throw new Error("storefront_effect_cart_scope_invalid");
      const ids = cart.items.map(item => item.variantId);
      if (new Set(cart.items.map(storefrontOptionLineIdentity)).size !== ids.length || cart.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) !== cart.total) {
        throw new Error("storefront_effect_cart_authority_invalid");
      }
      const uniqueIds = [...new Set(ids)];
      const rawRows = await tx.productVariant.findMany({
        where: { id: { in: uniqueIds }, isActive: true, product: { merchantId: scope.merchantId, isActive: true, deletedAt: null } },
        select: includeCostAnalytics ? catalogWithAnalyticsSelect : catalogSelect,
      });
      const rows = z.array(catalogSchema).max(uniqueIds.length).parse(rawRows);
      const byId = new Map(rows.map(row => [row.id, row]));
      if (rows.length !== uniqueIds.length || byId.size !== uniqueIds.length) throw new Error("storefront_effect_cart_authority_invalid");
      const costs = new Map<string, number>();
      const canonicalUnitPrices: number[] = [];
      let hasLegacySavedPrice = false;
      cart.items = cart.items.map((item, index) => {
        const row = byId.get(item.variantId);
        if (!row) throw new Error("storefront_effect_cart_authority_invalid");
        assertCatalog(row, scope.merchantId);
        const options = canonicalOptions(row, item.selectedOptions?.map(option => option.itemId));
        const snapshotOptions = [...(item.selectedOptions ?? [])].sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0);
        if (row.product.id !== item.productId || !isDeepStrictEqual(options.selected, snapshotOptions)
          || item.crossSellIntent && storefrontOptionLineIdentity(item) !== storefrontOptionLineIdentity({ variantId: item.variantId, selectedOptionItemIds: item.crossSellIntent.selectedOptionItemIds })) {
          throw new Error("storefront_effect_existing_price_or_product_changed");
        }
        if (item.crossSellIntent && options.price !== item.unitPriceCents) throw new Error("storefront_effect_existing_price_or_product_changed");
        if (item.unitPriceCents > options.price) throw new LegacySavedPriceReviewRequired("saved_price_above_catalog");
        if (item.unitPriceCents < options.price) hasLegacySavedPrice = true;
        canonicalUnitPrices[index] = options.price;
        if (includeCostAnalytics) {
          const rawPrice: unknown = rawRows.find(raw => raw.id === item.variantId)?.price;
          // Never execute an analytic getter or invent an unknown cost. Known
          // values are returned separately for diagnostics, not authorization.
          if (rawPrice && typeof rawPrice === "object") {
            const descriptor = Object.getOwnPropertyDescriptor(rawPrice, "costInCents");
            const cost: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
            if (typeof cost === "number" && Number.isSafeInteger(cost) && cost >= 0 && cost <= 2_147_483_647) costs.set(item.variantId, cost / 100);
          }
        }
        const { categoryId: _oldCategory, ...line } = item;
        return { ...line, sku: row.sku, name: row.product.name,
          ...(row.product.categoryId === null ? {} : { categoryId: row.product.categoryId }) };
      });
      const rules = merchantSchema.parse(await tx.merchantRule.findUnique({ where: { merchantId: scope.merchantId }, select: merchantSelect }));
      if (rules.merchantId !== scope.merchantId) throw new Error("storefront_effect_merchant_authority_invalid");
      let legacySavings = 0;
      if (hasLegacySavedPrice) {
        const saved = evaluateLegacySavedPriceBasis({ lines: cart.items.map((item, index) => ({ canonicalUnitPriceCents: canonicalUnitPrices[index]!,
          savedUnitPriceCents: item.unitPriceCents, quantity: item.quantity })), cartDiscountCents: cart.discount, maxDiscountPercent: rules.maxDiscountPercent });
        if (saved.kind !== "preserved") throw new LegacySavedPriceReviewRequired(saved.reason);
        cart.discountBudget = saved.budget; legacySavings = saved.budget.promotionDiscountCents;
      }
      const rawSetting = await tx.checkoutSetting.findUnique({ where: { merchantId: scope.merchantId }, select: { merchantId: true, advancedRules: true } });
      const setting = rawSetting === null ? null : settingSchema.parse(rawSetting);
      if (setting && setting.merchantId !== scope.merchantId) throw new Error("storefront_effect_merchant_authority_invalid");
      const advancedRules = setting?.advancedRules ?? [];
      if (advancedRules.some(rule => rule.enabled && (!rules.autonomousEngineEnabled || rule.productId !== undefined
        || rule.conditions.some(condition => condition.field === "payment_method" || condition.field === "trigger_fired")))) {
        throw new Error("storefront_effect_rules_unsupported");
      }
      // Automatic targets are recomputed; this isolated candidate excludes
      // coupon/manual benefits and never adds the prior automatic target again.
      if (!hasLegacySavedPrice) cart.discount = 0;
      cart.freeShipping = false;
      const now = suppliedClock ?? new Date();
      const promotions = z.array(promotionSchema).parse(await tx.productPromotion.findMany({
        where: { merchantId: scope.merchantId, isActive: true, startsAt: { lte: now }, endsAt: { gt: now }, OR: [
          { variantId: { in: rows.map(row => row.id) } }, { productId: { in: rows.map(row => row.product.id) } },
          { categoryId: { in: rows.flatMap(row => row.product.categoryId === null ? [] : [row.product.categoryId]) } },
        ] }, select: promotionSelect, orderBy: { id: "asc" },
      }));
      const chosen = cart.items.map((item, index) => selectBestProductPromotion({ merchantId: scope.merchantId, variantId: item.variantId,
        productId: item.productId, categoryId: item.categoryId, baseUnitPriceCents: item.unitPriceCents,
        promotions: item.unitPriceCents < canonicalUnitPrices[index]! ? [] : promotions, now }));
      const intents = cart.items.flatMap(item => item.crossSellIntent ? [item.crossSellIntent] : []);
      if (intents.length > 0) {
        const crossPromotions = z.array(crossPromotionSchema).parse(await tx.crossSellPromotion.findMany({
          where: { merchantId: scope.merchantId, id: { in: [...new Set(intents.map(intent => intent.promotionId))] } },
          select: storefrontCrossPromotionSelect, orderBy: { id: "asc" },
        }));
        if (new Set(crossPromotions.map(row => row.id)).size !== crossPromotions.length) throw new Error("cross_sell_quote_review_required");
        for (const [index, item] of cart.items.entries()) {
          if (!item.crossSellIntent) continue;
          const promotion = crossPromotions.find(row => row.id === item.crossSellIntent!.promotionId);
          if (!promotion) throw new Error("cross_sell_quote_review_required");
          // SKU is only unique within a product. Resolve the complete merchant SKU
          // set independently of cart membership before trusting the recommendation.
          const candidates = z.array(catalogSchema).max(2).parse(await tx.productVariant.findMany({
            where: { sku: item.sku, isActive: true, product: { merchantId: scope.merchantId, isActive: true, deletedAt: null } },
            select: catalogSelect, take: 2, orderBy: { id: "asc" },
          }));
          for (const candidate of candidates) assertCatalog(candidate, scope.merchantId);
          const { crossSellIntent: intent } = item;
          const result = buildCrossSellQuoteCandidate({ merchantId: scope.merchantId, now: now.toISOString(),
            intent: { version: intent.version, promotionId: intent.promotionId, promotionUpdatedAt: intent.promotionUpdatedAt,
              acceptedQuantity: intent.acceptedQuantity, originalUnitPriceCents: intent.originalUnitPriceCents },
            promotion: { id: promotion.id, merchantId: promotion.merchantId, updatedAt: promotion.updatedAt.toISOString(), status: promotion.status,
              startsAt: promotion.startsAt.toISOString(), endsAt: promotion.endsAt?.toISOString() ?? null,
              recommendedSkus: promotion.recommendedSkus, discountPercent: promotion.discountPercent.toString(), maxDiscountPercent: promotion.maxDiscountPercent.toString(),
              trigger: { ...(promotion.trigger.sku_in_cart ? { skuInCart: promotion.trigger.sku_in_cart } : {}),
                ...(promotion.trigger.category_in_cart ? { categoryInCart: promotion.trigger.category_in_cart } : {}),
                ...(promotion.trigger.cart_total_above === undefined ? {} : { cartTotalAboveCents: promotion.trigger.cart_total_above * 100 }) } },
            target: { variantId: item.variantId, productId: item.productId, sku: item.sku, quantity: item.quantity, baseUnitPriceCents: item.unitPriceCents,
              ...((item.selectedOptions?.length ?? 0) > 0 ? { optionModifierCents: item.selectedOptions!.reduce((sum, option) => sum + option.priceModifierInCents, 0) } : {}) },
            persistedCart: { kind: "persisted_cart", merchantId: scope.merchantId, subtotalCents: cart.total,
              items: cart.items.map(line => ({ variantId: line.variantId, productId: line.productId, sku: line.sku,
                quantity: line.quantity, unitPriceCents: line.unitPriceCents, ...(line.categoryId ? { categoryId: line.categoryId } : {}) })) },
            catalogVariants: candidates.map(row => ({ variantId: row.id, productId: row.product.id, sku: row.sku, merchantId: row.product.merchantId,
              isActive: row.isActive, productActive: row.product.isActive, productDeletedAt: null, currency: row.price!.currency, baseUnitPriceCents: row.price!.basePriceInCents })),
            ...(chosen[index]!.unitDiscountCents > 0 ? { productCandidate: { promotionId: chosen[index]!.promotionId!,
              unitPriceCents: chosen[index]!.unitPriceCents, unitDiscountCents: chosen[index]!.unitDiscountCents } } : {}),
          });
          if (result.kind !== "candidate") throw new Error("cross_sell_quote_review_required");
          chosen[index] = { ...chosen[index]!, unitPriceCents: result.unitPriceCents, unitDiscountCents: result.unitDiscountCents };
        }
      }
      const financialCosts: ReadonlyMap<string, number> = new Map();
      const financialCart = (value: StorefrontCart) => ({ ...toEngineCart(value, financialCosts),
        ...(hasLegacySavedPrice ? { currentDiscount: cart.discount / 100 } : {}) });
      const original = evaluateCombinedDiscount(financialCart(cart), rules, hasLegacySavedPrice ? cart.discount : 0);
      if (original.kind !== "authorized") throw new Error("storefront_effect_commercial_authority_invalid");
      const ordered = cart.items.map((item, index) => ({ index,
        identity: JSON.stringify([item.variantId, storefrontOptionLineIdentity(item), null]) }))
        .sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
      const keys = new Map(ordered.map((line, rank) => [line.index, String(rank).padStart(3, "0")]));
      const allocation = allocatePromotionDiscountBudget({ budgetCents: original.remainingDiscountCents,
        lines: cart.items.map((item, index) => ({ key: keys.get(index)!, baseUnitPriceCents: item.unitPriceCents,
          requestedUnitDiscountCents: chosen[index]!.unitDiscountCents, quantity: item.quantity })) });
      const projected: StorefrontCart = structuredClone(cart);
      const byKey = new Map(allocation.lines.map(line => [line.key, line]));
      projected.items.forEach((item, index) => { item.unitPriceCents = byKey.get(keys.get(index)!)!.unitPriceCents; });
      projected.total = cart.total - allocation.promotionDiscountCents;
      projected.discountBudget = { version: 1, originalSubtotalCents: cart.total + legacySavings, promotionDiscountCents: legacySavings + allocation.promotionDiscountCents };
      let notices: CommercialNotice[] | undefined;
      const promotionAuthority = evaluateCombinedDiscount(financialCart(projected), rules, hasLegacySavedPrice ? cart.discount : 0);
      if (promotionAuthority.kind === "requires_review") throw new Error("storefront_effect_commercial_authority_invalid");
      if (promotionAuthority.kind !== "authorized") {
        projected.items = structuredClone(cart.items); projected.total = cart.total;
        projected.discountBudget.promotionDiscountCents = 0;
        notices = [commercialNotice("benefit_conditions_not_met")];
      }
      const context = buildCartRuleContext(projected, { categoriesInCart: projected.items.flatMap(item => item.categoryId ? [item.categoryId] : []) });
      const outcome = new CartRulesEngine().evaluate(projected, advancedRules, rules, context, financialCosts);
      const decision = evaluateCombinedDiscount(financialCart(projected), rules, hasLegacySavedPrice ? cart.discount : outcome.discountCents);
      if (decision.kind === "requires_review") throw new Error("storefront_effect_commercial_authority_invalid");
      const discountCents = decision.kind === "authorized" ? decision.cartDiscountCents : 0;
      if (decision.kind !== "authorized" && projected.discountBudget.promotionDiscountCents > 0) {
        throw new Error("storefront_effect_commercial_authority_invalid");
      }
      if (decision.kind === "authorized" && decision.totalDiscountCents > 0 && decision.remainingDiscountCents === 0) notices = [commercialNotice("discount_limit_reached")];
      else if (rules.maxDiscountPercent === 0 && (chosen.some(line => line.unitDiscountCents > 0) || outcome.reason === "discount_disabled_by_merchant")) notices = [commercialNotice("discount_unavailable")];
      else if (!notices && (allocation.limitApplied || outcome.reason === "capped_by_combined_discount_limit")) notices = [commercialNotice("discount_limited")];
      else if (!notices && ["product_cost_missing", "minimum_margin_violation"].includes(outcome.reason)) notices = [commercialNotice("benefit_conditions_not_met")];
      if (cart.items.some((item, index) => item.crossSellIntent && projected.items[index]!.unitPriceCents > item.crossSellIntent.maximumUnitPriceCents)) {
        throw new Error("cross_sell_quote_review_required");
      }
      const outcomeV1 = storefrontLocalCartCommercialOutcomeV1Schema.parse({ version: 1, discountCents, freeShipping: false, quote: {
        currency: "BRL", originalSubtotalCents: cart.total + legacySavings, promotionDiscountCents: projected.discountBudget.promotionDiscountCents,
        subtotalCents: projected.total, merchandiseTotalCents: projected.total - discountCents,
        items: projected.items.map((item, index) => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity,
          ...((item.selectedOptions?.length ?? 0) > 0 ? { selectedOptionItemIds: item.selectedOptions!.map(option => option.itemId).sort() } : {}),
          baseUnitPriceCents: canonicalUnitPrices[index]!, unitPriceCents: item.unitPriceCents })),
        ...(notices ? { commercialNotices: notices } : {}),
      } });
      return { outcome: outcomeV1, costsByVariant: costs as ReadonlyMap<string, number> };
}

