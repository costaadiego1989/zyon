import type { NormalCheckoutCrossSellQuote } from "@zyon/contracts";

/** React host integration only; none of these UI callbacks grant server scope. */
export type CheckoutProductSelection = { variantId: string; sku: string; quantity: number; selectedOptionItemIds: string[] };
export type CheckoutProductDetailRequest = {
  key: string; merchantId: string; sessionId: string; suggestionId: string; productId: string; initialVariantId: string; initialSku: string;
  isCurrent: () => boolean;
  prepare: (selection: CheckoutProductSelection) => Promise<NormalCheckoutCrossSellQuote | null>;
  accept: (quote: NormalCheckoutCrossSellQuote, isCurrent?: () => boolean) => Promise<{ ok: boolean; error?: string; committedRequiresReview?: true }>;
};
export type OpenCheckoutProductDetail = (request: CheckoutProductDetailRequest) => void;
