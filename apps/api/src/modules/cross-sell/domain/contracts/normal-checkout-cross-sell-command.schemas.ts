/** Shared SDK/backend validation only; transaction-bound source authorization
 * remains server-owned. There is no second, divergent wire schema. */
export {
  normalCheckoutCrossSellScopeSchema, normalCheckoutCrossSellTargetSelectionSchema,
  normalCheckoutCrossSellQuoteRequestSchema, normalCheckoutCrossSellQuoteSchema,
  normalCheckoutCrossSellAcceptanceSchema, normalCheckoutCrossSellAcknowledgementSchema,
  normalCheckoutCrossSellHttpQuoteSchema, normalCheckoutCrossSellHttpAcceptanceSchema,
} from "@zyon/contracts";
export type {
  NormalCheckoutCrossSellScope, NormalCheckoutCrossSellTargetSelection,
  NormalCheckoutCrossSellQuoteRequest, NormalCheckoutCrossSellQuote,
  NormalCheckoutCrossSellAcceptance, NormalCheckoutCrossSellAcknowledgement,
} from "@zyon/contracts";
