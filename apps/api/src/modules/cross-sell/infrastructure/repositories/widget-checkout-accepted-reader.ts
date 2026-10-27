import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { lockCheckoutSessionAnchor } from "../../../../shared/persistence/checkout-session-lock.js";
import { FoodOptionValidationError } from "../../../storefront/domain/food-options.js";
import { storefrontOptionLineIdentity } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { commercialNotice } from "../../../storefront/domain/services/commercial-notice.js";
import { widgetCrossSellCheckoutProjectedCartSchema } from "../../domain/contracts/widget-cross-sell-checkout-projection.schemas.js";
import { widgetCrossSellCheckoutScopeSchema, widgetCrossSellCheckoutReceiptSchema,
  type WidgetCrossSellCheckoutScope } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { prepareWidgetCrossSellCheckoutQuote, widgetCrossSellCheckoutQuoteMatchesCurrent } from "../../domain/services/widget-cross-sell-checkout-quote.js";
import { readPrismaWidgetCrossSellCheckoutAuthority, requireWidgetCrossSellReview } from "./prisma-widget-cross-sell-checkout.authority.js";
import { readWidgetSelectedManualShipping } from "./widget-checkout-manual-shipping.js";

/** Shared lock order. A detached read must never authorize a later write. */
export async function lockAcceptedWidgetCheckout(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope, lockManualConfig = false) {
  const merchants = z.array(z.object({ id: widgetCrossSellCheckoutScopeSchema.shape.merchantId })).length(1)
    .parse(await tx.$queryRaw`SELECT id FROM merchants WHERE id=${scope.merchantId} FOR UPDATE`);
  if (merchants[0]!.id !== scope.merchantId) return requireWidgetCrossSellReview();
  await tx.$queryRaw`SELECT merchant_id FROM merchant_rules WHERE merchant_id=${scope.merchantId} FOR SHARE`;
  await tx.$queryRaw`SELECT merchant_id FROM checkout_settings WHERE merchant_id=${scope.merchantId} FOR SHARE`;
  if (lockManualConfig) await tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id=${scope.merchantId} FOR SHARE`;
  await lockCheckoutSessionAnchor(tx, scope.merchantId, scope.sessionId);
  await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId} FOR UPDATE`;
}

/** The existing canonical accepted-cart projection, now reusable in the SAME
 * transaction as admission. No client receipt, nested transaction or provider. */
export async function prepareAcceptedWidgetCheckout(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope,
  options: { lockManualConfig?: boolean; ownPaymentIntentId?: string } = {}) {
  await lockAcceptedWidgetCheckout(tx, scope, options.lockManualConfig);
  try {
    const row = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope }, select: { cart: true } });
    const rawCart = z.object({ _widgetCrossSellAcceptance: widgetCrossSellCheckoutReceiptSchema }).parse(row?.cart);
    const receipt = rawCart._widgetCrossSellAcceptance;
    await tx.$queryRaw`SELECT id FROM cross_sell_suggestions WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId}
      AND id=${receipt.quote.suggestionId} FOR UPDATE`;
    const authority = await readPrismaWidgetCrossSellCheckoutAuthority(tx, scope, {
      suggestionId: receipt.quote.suggestionId, variantId: receipt.quote.target.variantId,
      quantity: receipt.quote.target.acceptedQuantity, selectedOptionItemIds: receipt.quote.target.selectedOptionItemIds,
    }, "accepted_projection", options.ownPaymentIntentId);
    const quote = prepareWidgetCrossSellCheckoutQuote(authority.input);
    if (quote.kind !== "quote_candidate" || !widgetCrossSellCheckoutQuoteMatchesCurrent(receipt.quote, quote)) return requireWidgetCrossSellReview();
    const lines = new Map(quote.items.map(line => [storefrontOptionLineIdentity(line), line]));
    const { _widgetCrossSellAcceptance: _receipt, commercialNotices: _notices, discountBudget: _budget, ...base } = authority.cart;
    const projectedCart = widgetCrossSellCheckoutProjectedCartSchema.parse({ ...base, currentDiscount: 0, total: quote.totalCents / 100,
      items: authority.cart.items.map((item, index) => {
        const canonical = authority.baseItems[index]!, line = lines.get(storefrontOptionLineIdentity(canonical));
        if (!line) return requireWidgetCrossSellReview();
        const { originalPrice: _originalPrice, ...baseLine } = item;
        return { ...baseLine, sku: line.sku, variantId: line.variantId, product_id: line.productId, productType: "physical",
          variant: JSON.stringify([line.variantId, (line.selectedOptions ?? []).map(option => option.itemId).sort()]),
          name: authority.rows.find(row => row.id === line.variantId)!.product.name, price: line.unitPriceCents / 100,
          ...(line.unitPriceCents < line.baseUnitPriceCents ? { originalPrice: line.baseUnitPriceCents / 100 } : {}) };
      }), discountBudget: { version: 1, originalSubtotalCents: quote.originalSubtotalCents, promotionDiscountCents: quote.promotionDiscountCents },
      ...(quote.notice ? { commercialNotices: [commercialNotice(quote.notice)] } : {}) });
    return { ...authority, quote, receipt, projectedCart };
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof FoodOptionValidationError) return requireWidgetCrossSellReview();
    throw error;
  }
}

/** Internal payment reader. Shipping is recomputed under the same fences;
 * ownPaymentIntentId is only a lookup hint, independently proved by authority. */
export async function readAcceptedWidgetCheckoutInTransaction(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope,
  options: { ownPaymentIntentId?: string } = {}) {
  const current = await prepareAcceptedWidgetCheckout(tx, scope, { ...options, lockManualConfig: true });
  const selectedShipping = await readWidgetSelectedManualShipping(tx, scope, current);
  if (current.ownPaymentAuthority && (!isDeepStrictEqual(current.ownPaymentAuthority.frozenProjection.cart, current.projectedCart)
    || !isDeepStrictEqual(current.ownPaymentAuthority.frozenProjection.shipping, selectedShipping))) return requireWidgetCrossSellReview();
  return { ...current, selectedShipping };
}
