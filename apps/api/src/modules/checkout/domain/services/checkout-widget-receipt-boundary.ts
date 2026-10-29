const receiptKey = "_widgetCrossSellAcceptance";

/** Presence is reserved, not authority. Until canonical widget receipt
 * projection is integrated, generic paths must not lose the benefit, expose
 * private data or charge the original storage base. No parsing grants access. */
export function assertNoUnprojectedWidgetReceipt(cart: unknown): void {
  let present: boolean;
  try {
    present = typeof cart === "object" && cart !== null && receiptKey in cart;
  } catch {
    // Do not expose caller-controlled proxy errors or private receipt values.
    throw new Error("cross_sell_quote_review_required");
  }
  if (present) throw new Error("cross_sell_quote_review_required");
}
