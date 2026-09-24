import type { Cart, ChatTurn, CheckoutSession, CustomerHints, ShippingQuote } from "@zyon/shared-types";

export function toCheckoutSession(row: {
  merchantId: string;
  sessionId: string;
  globalUserId: string;
  conversationId: string;
  cart: unknown;
  customer: unknown | null;
  shipping: unknown | null;
  shippingOptions?: unknown | null;
  abandonmentScore: number;
  triggerAgent: boolean;
  chatHistory?: unknown | null;
  promptVariantId?: string | null;
  cohort?: string | null;
  featuresApplied?: unknown | null;
  aiCostCents?: number | null;
  createdAt: Date;
  updatedAt: Date;
}): CheckoutSession {
  return {
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    globalUserId: row.globalUserId,
    conversationId: row.conversationId,
    cart: row.cart as Cart,
    customer: (row.customer ?? undefined) as CustomerHints | undefined,
    shipping: (row.shipping ?? undefined) as ShippingQuote | undefined,
    shippingOptions: (row.shippingOptions ?? undefined) as ShippingQuote[] | undefined,
    abandonmentScore: row.abandonmentScore,
    triggerAgent: row.triggerAgent,
    chatHistory: ((row.chatHistory ?? []) as ChatTurn[]),
    promptVariantId: row.promptVariantId ?? undefined,
    cohort: (row.cohort ?? undefined) as "holdout" | "treatment" | undefined,
    featuresApplied: (row.featuresApplied ?? undefined) as CheckoutSession["featuresApplied"],
    aiCostCents: row.aiCostCents ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
