import type { ChatTurn, CheckoutSession, CustomerHints, ShippingQuote } from "@zyon/shared-types";
import { stripStoredCheckoutCouponBinding } from "./checkout-coupon-storage.js";
import { assertNoUnprojectedWidgetReceipt } from "./checkout-widget-receipt-boundary.js";

/** Pure stored-row -> domain snapshot projection. This maps already loaded
 * data; it never grants financial authority or weakens private-field guards. */
export function toCheckoutSession(row: {
  merchantId: string; sessionId: string; globalUserId: string; conversationId: string;
  cart: unknown; customer: unknown | null; shipping: unknown | null; shippingOptions?: unknown | null;
  abandonmentScore: number; triggerAgent: boolean; chatHistory?: unknown | null;
  paymentMethod?: string | null; promptVariantId?: string | null; cohort?: string | null;
  featuresApplied?: unknown | null; aiCostCents?: number | null; version?: number;
  createdAt: Date; updatedAt: Date;
}): CheckoutSession {
  assertNoUnprojectedWidgetReceipt(row.cart);
  return {
    merchantId: row.merchantId, sessionId: row.sessionId, globalUserId: row.globalUserId, conversationId: row.conversationId,
    cart: stripStoredCheckoutCouponBinding(row.cart),
    customer: (row.customer ?? undefined) as CustomerHints | undefined,
    shipping: (row.shipping ?? undefined) as ShippingQuote | undefined,
    shippingOptions: (row.shippingOptions ?? undefined) as ShippingQuote[] | undefined,
    abandonmentScore: row.abandonmentScore, triggerAgent: row.triggerAgent,
    chatHistory: ((row.chatHistory ?? []) as ChatTurn[]),
    paymentMethod: (row.paymentMethod ?? undefined) as CheckoutSession["paymentMethod"],
    promptVariantId: row.promptVariantId ?? undefined,
    cohort: (row.cohort ?? undefined) as "holdout" | "treatment" | undefined,
    featuresApplied: (row.featuresApplied ?? undefined) as CheckoutSession["featuresApplied"],
    aiCostCents: row.aiCostCents ?? 0,
    ...(row.version !== undefined ? { persistenceVersion: row.version } : {}),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}
