/**
 * The classified reason a buyer abandoned their checkout session.
 * Deterministic classification from event log — no LLM involved.
 */
export type AbandonmentReason =
  | "shipping_cost"
  | "price"
  | "payment"
  | "hesitation"
  | "trust"
  | "unknown";
