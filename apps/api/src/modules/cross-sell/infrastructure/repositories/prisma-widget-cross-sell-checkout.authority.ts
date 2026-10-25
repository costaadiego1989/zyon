import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import type { Cart } from "@zyon/shared-types";
import { selectBestProductPromotion } from "../../../catalog/domain/services/best-product-promotion.service.js";
import { validateFoodMetadata, foodSelectionLimits } from "../../../catalog/domain/services/food-options-validation.js";
import { extractOptionGroups, resolveSelectedOptions } from "../../../storefront/domain/food-options.js";
import { storefrontSelectedOptionsSchema, storefrontOptionItemIdsSchema } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { widgetCrossSellCheckoutQuoteInputSchema } from "../../domain/contracts/widget-cross-sell-checkout-quote.schemas.js";
import { widgetCrossSellCheckoutReceiptSchema, type WidgetCrossSellCheckoutScope, type WidgetCrossSellCheckoutQuoteRequest } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { widgetCrossSellCheckoutAcceptancePayload } from "../../domain/events/cross-sell-domain-event.js";
import { widgetCheckoutRevisionContextHash, widgetCheckoutRevisionMetadata, widgetCheckoutRevisionEventName } from "./widget-cross-sell-checkout-revision.js";
import { readWidgetCheckoutOwnPayment } from "./widget-checkout-own-payment.js";

const id = widgetCrossSellCheckoutQuoteInputSchema.shape.merchantId;
const cents = z.number().int().min(0).max(2_147_483_647);
const decimal = z.custom<Prisma.Decimal>(value => Prisma.Decimal.isDecimal(value));
const cartItem = z.object({ sku: id, variantId: id.optional(), product_id: id.optional(),
  price: z.number().finite().nonnegative(), originalPrice: z.number().finite().nonnegative().optional(),
  quantity: z.number().int().min(1).max(99), variant: z.string().optional(), selected_options: z.array(z.unknown()).max(250).optional(),
}).passthrough();
const cartSchema = z.object({ currency: z.literal("BRL"), total: z.number().finite().nonnegative(), items: z.array(cartItem).max(200),
  source: z.literal("checkout").optional(), currentDiscount: z.literal(0).optional(),
  couponCode: z.null().optional(), freeShipping: z.literal(false).optional(),
  discountBudget: z.strictObject({ version: z.literal(1), originalSubtotalCents: cents, promotionDiscountCents: cents }).optional(),
}).passthrough();
const sessionSchema = z.object({ id, merchantId: id, sessionId: id, version: z.number().int().min(0).max(2_147_483_647),
  cart: cartSchema, shipping: z.unknown().optional(), strategyContextVersion: z.number().int().nonnegative(),
  globalUserId: id, customer: z.record(z.string(), z.unknown()).nullish(), shippingOptions: z.unknown().optional(), paymentMethod: z.string().nullish(),
});
const catalogSelect = { id: true, sku: true, isActive: true,
  weightGrams: true, heightCm: true, widthCm: true, lengthCm: true,
  media: { select: { url: true }, orderBy: { order: "asc" }, take: 1 },
  price: { select: { variantId: true, basePriceInCents: true, currency: true } },
  product: { select: { id: true, merchantId: true, name: true, type: true, isActive: true, deletedAt: true, metadata: true, categoryId: true } },
  stock: { select: { quantity: true, reserved: true } },
} as const satisfies Prisma.ProductVariantSelect;
const catalogSchema = z.object({ id, sku: id, isActive: z.literal(true),
  weightGrams: cents.nullable(), heightCm: z.number().finite().nonnegative().nullable(),
  widthCm: z.number().finite().nonnegative().nullable(), lengthCm: z.number().finite().nonnegative().nullable(),
  media: z.array(z.object({ url: z.string().min(1).max(2048) })).max(1),
  price: z.object({ variantId: id, basePriceInCents: cents, currency: z.literal("BRL") }),
  product: z.object({ id, merchantId: id, name: z.string().min(1).max(1000), type: z.literal("physical"),
    isActive: z.literal(true), deletedAt: z.null(), metadata: z.unknown().refine(value => value !== undefined), categoryId: id.nullable() }),
  stock: z.array(z.object({ quantity: cents, reserved: cents })).max(200),
});
const promotionSelect = { id: true, merchantId: true, productId: true, variantId: true, categoryId: true,
  couponId: true, discountType: true, discountValue: true, promoPriceInCents: true, isActive: true, startsAt: true, endsAt: true } as const;
const promotionSchema = z.object({ id, merchantId: id, productId: id.nullable(), variantId: id.nullable(), categoryId: id.nullable(),
  couponId: id.nullable(), discountType: z.string().nullable(), discountValue: z.number().finite().nullable(),
  promoPriceInCents: cents.nullable(), isActive: z.boolean(), startsAt: z.date(), endsAt: z.date() });
const rawPromotionSchema = z.object({ id, merchantId: id, updatedAt: z.date(), status: z.enum(["active", "archived"]),
  startsAt: z.date(), endsAt: z.date().nullable(), recommendedSkus: z.array(id).min(1).max(200),
  discountPercent: decimal, maxDiscountPercent: decimal,
  trigger: z.strictObject({ sku_in_cart: z.array(id).min(1).max(200).optional(), category_in_cart: z.array(id).min(1).max(200).optional(),
    cart_total_above: z.number().finite().nonnegative().optional() }) });

export class WidgetCrossSellCheckoutReviewError extends Error {
  readonly code = "cross_sell_quote_review_required";
  constructor() { super("cross_sell_quote_review_required"); }
}
export const requireWidgetCrossSellReview = (): never => { throw new WidgetCrossSellCheckoutReviewError(); };
const requiredCents = (value: unknown) => { const result = moneyCents(value); return result === null ? requireWidgetCrossSellReview() : cents.parse(result); };

function optionIds(item: z.infer<typeof cartItem>, canonicalVariantId: string): string[] {
  if (!item.variant) return item.selected_options?.length ? requireWidgetCrossSellReview() : [];
  let value: unknown;
  try { value = JSON.parse(item.variant); } catch { return item.selected_options?.length ? requireWidgetCrossSellReview() : []; }
  const identity = z.tuple([id, storefrontOptionItemIdsSchema]).safeParse(value);
  if (!identity.success || identity.data[0] !== canonicalVariantId) return requireWidgetCrossSellReview();
  return identity.data[1];
}

function options(row: z.infer<typeof catalogSchema>, ids: string[]) {
  if (validateFoodMetadata(row.product.metadata)) return requireWidgetCrossSellReview();
  const selected = resolveSelectedOptions(extractOptionGroups(row.product.metadata), ids);
  const canonical = storefrontSelectedOptionsSchema.parse(selected.selected).sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
  const metadata = row.product.metadata as { optionGroups?: Array<{ id: string; items: unknown[]; required?: boolean; selectionType?: string; minSelections?: number; maxSelections?: number }> } | null;
  for (const group of metadata?.optionGroups ?? []) {
    const count = canonical.filter(option => option.groupId === group.id).length, limits = foodSelectionLimits(group);
    if (count < limits.min || count > limits.max) return requireWidgetCrossSellReview();
  }
  return { canonical, price: cents.parse(row.price.basePriceInCents + selected.priceModifierInCents) };
}

/** Called after merchant/config/session/suggestion locks. Only this transaction
 * supplies canonical inputs. No fallback client, defaults, grant or nested tx. */
export async function readPrismaWidgetCrossSellCheckoutAuthority(tx: Prisma.TransactionClient,
  scope: WidgetCrossSellCheckoutScope, request: WidgetCrossSellCheckoutQuoteRequest, purpose: "pending" | "accepted_projection" = "pending", ownPaymentIntentId?: string) {
  const stored = sessionSchema.parse(await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } }));
  if (stored.merchantId !== scope.merchantId || stored.sessionId !== scope.sessionId) return requireWidgetCrossSellReview();
  if (purpose === "pending" && stored.version === 2_147_483_647) return requireWidgetCrossSellReview();
  const cart = stored.cart;
  const receipt = purpose === "accepted_projection" ? widgetCrossSellCheckoutReceiptSchema.parse(cart._widgetCrossSellAcceptance) : undefined;
  if (receipt && (receipt.quote.merchantId !== scope.merchantId || receipt.quote.sessionId !== scope.sessionId
    || (receipt.revision?.persistenceVersion ?? receipt.committedVersion) !== stored.version || receipt.acceptedAt !== receipt.quote.quotedAt
    || receipt.quote.suggestionId !== request.suggestionId || receipt.quote.target.variantId !== request.variantId
    || receipt.quote.target.acceptedQuantity !== request.quantity
    || !isDeepStrictEqual(receipt.quote.target.selectedOptionItemIds ?? [], request.selectedOptionItemIds ?? []))) return requireWidgetCrossSellReview();
  if (Object.keys(cart).some(key => key.startsWith("_") && !(receipt && key === "_widgetCrossSellAcceptance")) || cart.cart_ref !== undefined || cart.commerceCartRef !== undefined
    || cart.commercialNudge !== undefined || (Array.isArray(cart.appliedBenefits) && cart.appliedBenefits.length > 0)
    || cart.items.some(item => Object.hasOwn(item, "crossSellIntent") || Object.hasOwn(item, "marketplace")
      || Object.keys(item).some(key => key.startsWith("_")))) return requireWidgetCrossSellReview();
  const shipping = stored.shipping;
  if (shipping && typeof shipping === "object") {
    const quote = shipping as Record<string, unknown>;
    if (quote.freeShipping === true || quote.discount !== undefined && quote.discount !== 0
      || typeof quote.originalCustomerPrice === "number" && quote.originalCustomerPrice !== quote.customerPrice) return requireWidgetCrossSellReview();
  }
  const ownPaymentAuthority = ownPaymentIntentId === undefined ? undefined
    : await readWidgetCheckoutOwnPayment(tx, scope, stored, receipt, ownPaymentIntentId);
  if (await tx.paymentIntent.findFirst({ where: { ...scope, status: { notIn: ["failed", "cancelled"] },
    ...(ownPaymentAuthority ? { id: { not: ownPaymentAuthority.paymentId } } : {}) }, select: { id: true } })
    || await tx.completedOrder.findFirst({ where: scope, select: { id: true } })
    || await tx.checkoutChatRequest.findFirst({ where: { ...scope, status: { in: ["processing", "unknown"] } }, select: { id: true } })
    || await tx.checkoutEvent.findFirst({ where: { ...scope, eventName: "checkout_abandoned", metadata: { path: ["reason"], equals: "buyer_initiated" } }, select: { id: true } })
    || await tx.couponRedemption.findFirst({ where: { ...scope, status: { not: "cancelled" } }, select: { id: true } })
    || await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: scope }, select: { id: true } })
    || await tx.strategyIncentiveReservation.findFirst({ where: { ...scope, status: { in: ["reserved", "spent"] } }, select: { id: true } })) return requireWidgetCrossSellReview();
  const suggestion = z.object({ id, merchantId: id, sessionId: id, promoId: id, status: z.enum(["pending", "accepted"]), rankedItems: z.array(id).min(1).max(200),
    resolvedAt: z.date().nullable().optional(), computedDiscount: decimal.optional() })
    .parse(await tx.crossSellSuggestion.findFirst({ where: { id: request.suggestionId, ...scope } }));
  if (suggestion.id !== request.suggestionId || suggestion.merchantId !== scope.merchantId || suggestion.sessionId !== scope.sessionId
    || suggestion.status !== (receipt ? "accepted" : "pending")) return requireWidgetCrossSellReview();
  if (receipt) {
    // Lock and reread actual evidence; no caller-supplied receipt, fabricated
    // transaction delegate or status override is used to grant the benefit.
    await tx.$queryRaw`SELECT id FROM checkout_events WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId}
      AND event_name='cross_sell_accepted' AND metadata->>'acceptance_event_id'=${receipt.eventId} ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE merchant_id=${scope.merchantId} AND event_id=${receipt.eventId} FOR SHARE`;
    const event = z.object({ merchantId: id, sessionId: id, eventName: z.literal("cross_sell_accepted"), occurredAt: z.date(), metadata: z.unknown() })
      .parse(await tx.checkoutEvent.findFirst({ where: { ...scope, eventName: "cross_sell_accepted", metadata: { path: ["acceptance_event_id"], equals: receipt.eventId } },
        select: { merchantId: true, sessionId: true, eventName: true, occurredAt: true, metadata: true } }));
    const outbox = z.object({ eventId: id, eventType: z.literal("cross-sell.offer.accepted"), schemaVersion: z.literal(1), merchantId: id,
      occurredAt: z.date(), causationId: id, producer: z.literal("cross-sell"), payload: z.unknown() })
      .parse(await tx.outboxMessage.findFirst({ where: { merchantId: scope.merchantId, eventId: receipt.eventId },
        select: { eventId: true, eventType: true, schemaVersion: true, merchantId: true, occurredAt: true, causationId: true, producer: true, payload: true } }));
    const payload = widgetCrossSellCheckoutAcceptancePayload(receipt.quote, receipt.committedVersion);
    const acceptedAt = new Date(receipt.acceptedAt).getTime();
    if (suggestion.promoId !== receipt.quote.target.promotionId || !isDeepStrictEqual(suggestion.rankedItems, [receipt.quote.target.sku])
      || suggestion.resolvedAt?.getTime() !== acceptedAt || suggestion.computedDiscount?.toNumber() !== payload.computed_discount
      || event.merchantId !== scope.merchantId || event.sessionId !== scope.sessionId || event.occurredAt.getTime() !== acceptedAt
      || !isDeepStrictEqual(event.metadata, { suggestion_id: suggestion.id, acceptance_event_id: receipt.eventId, checkout_version: receipt.committedVersion })
      || outbox.eventId !== receipt.eventId || outbox.merchantId !== scope.merchantId || outbox.causationId !== suggestion.id
      || outbox.occurredAt.getTime() !== acceptedAt || !isDeepStrictEqual(outbox.payload, payload)) return requireWidgetCrossSellReview();
    if (receipt.revision) {
      const revision = receipt.revision;
      await tx.$queryRaw`SELECT id FROM checkout_events WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId}
        AND id=${revision.eventId} FOR SHARE`;
      const eventName = widgetCheckoutRevisionEventName(receipt);
      const revisionEvent = z.object({ id, merchantId: id, sessionId: id, eventName: z.literal(eventName),
        occurredAt: z.date(), metadata: z.unknown() }).parse(await tx.checkoutEvent.findFirst({
        where: { id: revision.eventId, ...scope, eventName },
        select: { id: true, merchantId: true, sessionId: true, eventName: true, occurredAt: true, metadata: true },
      }));
      if (revisionEvent.id !== revision.eventId || revisionEvent.merchantId !== scope.merchantId || revisionEvent.sessionId !== scope.sessionId
        || revisionEvent.occurredAt.getTime() !== Date.parse(revision.revisedAt)
        || !isDeepStrictEqual(revisionEvent.metadata, widgetCheckoutRevisionMetadata(receipt))
        || widgetCheckoutRevisionContextHash(stored) !== revision.contextHash) return requireWidgetCrossSellReview();
    }
  }
  const skus = [...new Set(cart.items.map(item => item.sku))].sort();
  const probeSchema = z.array(z.object({ id, sku: id })).max(400);
  const probe = probeSchema.parse(await tx.productVariant.findMany({ where: { product: { merchantId: scope.merchantId },
    OR: [{ sku: { in: skus } }, { id: request.variantId }] }, select: { id: true, sku: true }, take: 401 }));
  const initialTarget = probe.filter(row => row.id === request.variantId);
  if (initialTarget.length !== 1) return requireWidgetCrossSellReview();
  const targetSku = initialTarget[0]!.sku;
  const skuProbe = probeSchema.parse(await tx.productVariant.findMany({ where: { sku: targetSku,
    product: { merchantId: scope.merchantId } }, select: { id: true, sku: true }, take: 401 }));
  const ids = [...new Set([...probe, ...skuProbe].map(row => row.id))].sort();
  if (ids.length > 400) return requireWidgetCrossSellReview();
  // Lock only bounded referenced rows in deterministic order. Merchant fence
  // serializes cooperative catalog writers/phantoms. Probes are not authority:
  // reread complete SKU sets after waits and reject newly appeared row IDs.
  await tx.$queryRaw`SELECT p.id FROM products p WHERE p.merchant_id=${scope.merchantId}
    AND p.id IN (SELECT v.product_id FROM product_variants v WHERE v.id=ANY(${ids}::text[])) ORDER BY p.id FOR SHARE OF p`;
  await tx.$queryRaw`SELECT v.id FROM product_variants v JOIN products p ON p.id=v.product_id
    WHERE p.merchant_id=${scope.merchantId} AND v.id=ANY(${ids}::text[]) ORDER BY v.id FOR SHARE OF v`;
  await tx.$queryRaw`SELECT price.id FROM product_prices price JOIN product_variants v ON v.id=price.variant_id JOIN products p ON p.id=v.product_id
    WHERE p.merchant_id=${scope.merchantId} AND v.id=ANY(${ids}::text[]) ORDER BY price.id FOR SHARE OF price`;
  await tx.$queryRaw`SELECT stock.id FROM product_stock stock JOIN product_variants v ON v.id=stock.variant_id JOIN products p ON p.id=v.product_id
    WHERE p.merchant_id=${scope.merchantId} AND v.id=ANY(${ids}::text[]) ORDER BY stock.id FOR SHARE OF stock`;
  await tx.$queryRaw`SELECT promotion.id FROM product_promotions promotion WHERE promotion.merchant_id=${scope.merchantId}
    AND (promotion.variant_id=ANY(${ids}::text[])
      OR promotion.product_id IN (SELECT v.product_id FROM product_variants v WHERE v.id=ANY(${ids}::text[]))
      OR promotion.category_id IN (SELECT p.category_id FROM products p JOIN product_variants v ON v.product_id=p.id
        WHERE p.merchant_id=${scope.merchantId} AND v.id=ANY(${ids}::text[]))) ORDER BY promotion.id FOR SHARE OF promotion`;
  await tx.$queryRaw`SELECT id FROM cross_sell_promotions WHERE merchant_id=${scope.merchantId} AND id=${suggestion.promoId} FOR SHARE`;
  const rows = z.array(catalogSchema).max(400).parse(await tx.productVariant.findMany({
    where: { product: { merchantId: scope.merchantId }, sku: { in: [...skus, targetSku] } }, select: catalogSelect, take: 401,
  }));
  if (rows.length !== ids.length || rows.some(row => !ids.includes(row.id))) return requireWidgetCrossSellReview();
  const targetRows = rows.filter(row => row.id === request.variantId);
  if (targetRows.length !== 1) return requireWidgetCrossSellReview();
  const target = targetRows[0]!;
  // Resolve the target's complete SKU set separately, not only the requested ID.
  const targetMatches = z.array(catalogSchema).max(200).parse(await tx.productVariant.findMany({
    where: { sku: target.sku, product: { merchantId: scope.merchantId } }, select: catalogSelect,
  }));
  if (targetMatches.length !== 1 || targetMatches[0]!.id !== target.id || !suggestion.rankedItems.includes(target.sku)) return requireWidgetCrossSellReview();
  const rawRules = z.object({ merchantId: id, maxDiscountPercent: decimal }).parse(await tx.merchantRule.findUnique({
    where: { merchantId: scope.merchantId }, select: { merchantId: true, maxDiscountPercent: true },
  }));
  if (rawRules.merchantId !== scope.merchantId) return requireWidgetCrossSellReview();
  const setting = await tx.checkoutSetting.findUnique({ where: { merchantId: scope.merchantId }, select: { merchantId: true, advancedRules: true } });
  if (setting) {
    const checked = z.object({ merchantId: id, advancedRules: z.array(z.object({ enabled: z.boolean(),
      action: z.object({ type: z.enum(["offer_discount", "offer_free_shipping", "offer_coupon", "show_message", "suggest_product", "do_nothing", "offer_installments"]) }) })).max(20).nullable() }).parse(setting);
    if (checked.merchantId !== scope.merchantId || checked.advancedRules?.some(rule => rule.enabled
      && ["offer_discount", "offer_free_shipping", "offer_coupon"].includes(rule.action.type))) return requireWidgetCrossSellReview();
  }
  const promotion = rawPromotionSchema.parse(await tx.crossSellPromotion.findFirst({ where: { id: suggestion.promoId, merchantId: scope.merchantId } }));
  const products = z.array(promotionSchema).parse(await tx.productPromotion.findMany({ where: { merchantId: scope.merchantId,
    OR: [{ variantId: { in: ids } }, { productId: { in: rows.map(row => row.product.id) } },
      { categoryId: { in: rows.flatMap(row => row.product.categoryId === null ? [] : [row.product.categoryId]) } }] }, select: promotionSelect }));
  const [clock] = z.array(z.object({ now: z.date() })).length(1).parse(await tx.$queryRaw`SELECT clock_timestamp() AS now`);
  if (receipt && (Date.parse(receipt.acceptedAt) > clock!.now.getTime()
    || receipt.revision && Date.parse(receipt.revision.revisedAt) > clock!.now.getTime())) return requireWidgetCrossSellReview();
  const policy = { merchantId: rawRules.merchantId, maxDiscountPercent: rawRules.maxDiscountPercent.toNumber() };
  const pricingBasis: Cart = { currency: cart.currency, total: cart.total, currentDiscount: 0,
    items: cart.items.map(item => ({ sku: item.sku, name: item.sku, price: item.price, quantity: item.quantity })),
    ...(cart.discountBudget ? { discountBudget: cart.discountBudget } : {}) };
  if (evaluateCombinedDiscount(pricingBasis, policy, 0).kind !== "authorized") return requireWidgetCrossSellReview();
  const stockRequests = new Map<string, number>();
  const resolve = (row: z.infer<typeof catalogSchema>, quantity: number, ids: string[]) => {
    if (row.product.merchantId !== scope.merchantId || row.price.variantId !== row.id) return requireWidgetCrossSellReview();
    const selection = options(row, ids);
    stockRequests.set(row.id, (stockRequests.get(row.id) ?? 0) + quantity);
    const selectedPromotion = selectBestProductPromotion({ merchantId: scope.merchantId, productId: row.product.id, variantId: row.id,
      categoryId: row.product.categoryId ?? undefined, baseUnitPriceCents: selection.price, promotions: products, now: clock!.now });
    return { variantId: row.id, productId: row.product.id, sku: row.sku, quantity, baseUnitPriceCents: selection.price,
      ...(row.product.categoryId === null ? {} : { categoryId: row.product.categoryId }),
      ...(selection.canonical.length ? { selectedOptions: selection.canonical } : {}),
      ...(selectedPromotion.promotionId ? { productCandidate: { promotionId: selectedPromotion.promotionId,
        unitPriceCents: selectedPromotion.unitPriceCents, unitDiscountCents: selectedPromotion.unitDiscountCents } } : {}) };
  };
  const baseItems = cart.items.map(item => {
    const matches = rows.filter(row => row.sku === item.sku);
    if (matches.length !== 1) return requireWidgetCrossSellReview();
    const row = matches[0]!;
    if (item.variantId !== undefined && item.variantId !== row.id || item.product_id !== undefined && item.product_id !== row.product.id) return requireWidgetCrossSellReview();
    const line = resolve(row, item.quantity, optionIds(item, row.id));
    if (requiredCents(item.originalPrice ?? item.price) !== line.baseUnitPriceCents) return requireWidgetCrossSellReview();
    const snapshot = (line.selectedOptions ?? []).map(option => ({ group_name: option.groupName, item_name: option.itemName, price_modifier: option.priceModifierInCents / 100 }));
    if (!isDeepStrictEqual(item.selected_options ?? [], snapshot)) return requireWidgetCrossSellReview();
    return line;
  });
  const targetLine = receipt ? baseItems.find(line => line.variantId === request.variantId) : resolve(target, request.quantity, request.selectedOptionItemIds ?? []);
  if (!targetLine || targetLine.quantity !== request.quantity) return requireWidgetCrossSellReview();
  if (receipt && (baseItems.filter(line => line.variantId === request.variantId).length !== 1
    || cart.items.some((item, index) => requiredCents(item.price) !== baseItems[index]!.baseUnitPriceCents
      || item.originalPrice !== undefined && requiredCents(item.originalPrice) !== baseItems[index]!.baseUnitPriceCents))) return requireWidgetCrossSellReview();
  for (const [variantId, quantity] of stockRequests) {
    const row = rows.find(row => row.id === variantId)!;
    const available = row.stock.reduce((sum, stock) => sum + BigInt(stock.quantity) - BigInt(stock.reserved), 0n);
    if (available < BigInt(quantity)) return requireWidgetCrossSellReview();
  }
  const original = baseItems.reduce((sum, line) => sum + BigInt(line.baseUnitPriceCents) * BigInt(line.quantity), 0n);
  if (original !== BigInt(cart.discountBudget && typeof cart.discountBudget === "object" && "originalSubtotalCents" in cart.discountBudget
    ? cents.parse(cart.discountBudget.originalSubtotalCents) : requiredCents(cart.total))) return requireWidgetCrossSellReview();
  const trigger = promotion.trigger;
  const canonicalInput = widgetCrossSellCheckoutQuoteInputSchema.parse({ merchantId: scope.merchantId, now: clock!.now.toISOString(),
    suggestion: { id: suggestion.id, merchantId: suggestion.merchantId, sessionId: suggestion.sessionId,
      promotionId: suggestion.promoId, status: "pending", rankedSkus: suggestion.rankedItems },
    // Reconstruct only the planner's original pre-add basis from the validated
    // accepted transaction. This does not change the accepted suggestion/cart.
    checkout: { ...scope, persistenceVersion: receipt?.quote.persistenceVersion ?? stored.version, currency: "BRL",
      items: receipt ? baseItems.filter(line => line.variantId !== request.variantId) : baseItems,
      currentDiscountCents: 0, couponCode: null, freeShipping: false, hasActiveCouponReservation: false },
    promotion: { id: promotion.id, merchantId: promotion.merchantId, updatedAt: promotion.updatedAt.toISOString(),
      status: promotion.status, startsAt: promotion.startsAt.toISOString(), endsAt: promotion.endsAt?.toISOString() ?? null,
      recommendedSkus: promotion.recommendedSkus, discountPercent: promotion.discountPercent.toString(),
      maxDiscountPercent: promotion.maxDiscountPercent.toString(), trigger: {
        ...(trigger.sku_in_cart === undefined ? {} : { skuInCart: trigger.sku_in_cart }),
        ...(trigger.category_in_cart === undefined ? {} : { categoryInCart: trigger.category_in_cart }),
        ...(trigger.cart_total_above === undefined ? {} : { cartTotalAboveCents: requiredCents(trigger.cart_total_above) }),
      } },
    catalogVariants: targetMatches.map(row => ({ variantId: row.id, productId: row.product.id, sku: row.sku,
      merchantId: row.product.merchantId, isActive: row.isActive, productActive: row.product.isActive,
      productDeletedAt: null, currency: row.price.currency, baseUnitPriceCents: row.price.basePriceInCents })), target: targetLine, policy });
  if (ownPaymentAuthority && Date.parse(ownPaymentAuthority.admittedAt) > clock!.now.getTime()) return requireWidgetCrossSellReview();
  return { stored, cart, rows, baseItems, input: canonicalInput, receipt, ownPaymentAuthority };
}
