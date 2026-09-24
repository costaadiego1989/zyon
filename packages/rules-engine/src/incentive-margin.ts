import type { Cart } from "@zyon/shared-types";

export const INCENTIVE_MARGIN_DEFINITION = "known-product-cost-margin-v1";
export interface IncentiveMargin {
  definition: typeof INCENTIVE_MARGIN_DEFINITION;
  status: "estimated" | "unavailable";
  reason: string;
  revenueCents: number | null;
  productCostCents: number | null;
  paymentFeesCents: number | null;
  shippingCostCents: number | null;
  marginCents: number | null;
  marginPercent: number | null;
}

// Reject values with sub-cent precision instead of quietly changing an authority's price.
export function moneyCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 0.000001 ? cents : null;
}

/** A forecast under an explicit fee assumption, NOT measured contribution.
 * Shipping receipts and carrier expense are independent components. */
export function assessIncentiveMargin(cart: Cart, input: {
  totalDiscount: number;
  shippingRevenue?: number;
  shippingCost?: number;
  paymentFeeRate?: number;
}): IncentiveMargin {
  const unavailable = (reason: string): IncentiveMargin => ({
    definition: INCENTIVE_MARGIN_DEFINITION, status: "unavailable", reason,
    revenueCents: null, productCostCents: null, paymentFeesCents: null,
    shippingCostCents: null, marginCents: null, marginPercent: null,
  });
  const total = moneyCents(cart?.total);
  const discount = moneyCents(input.totalDiscount);
  const shippingRevenue = moneyCents(input.shippingRevenue ?? 0);
  const shippingCost = moneyCents(input.shippingCost ?? 0);
  const feeRate = input.paymentFeeRate ?? 0.04; // Existing forecasting assumption, not an invoice.
  if (total === null || discount === null || shippingRevenue === null || shippingCost === null ||
      !Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1 || discount > total) {
    return unavailable("economic_input_invalid");
  }
  if (!Array.isArray(cart.items) || !cart.items.length) return unavailable("product_cost_missing");
  let itemTotal = 0;
  let cost = 0;
  for (const item of cart.items) {
    if (item.selected_options?.length) return unavailable("product_option_cost_missing");
    if (item.cost == null) return unavailable("product_cost_missing");
    const unitCost = moneyCents(item.cost);
    const unitPrice = moneyCents(item.price);
    if (unitCost === null || unitPrice === null || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      return unavailable("economic_input_invalid");
    }
    itemTotal += unitPrice * item.quantity;
    cost += unitCost * item.quantity;
    if (!Number.isSafeInteger(itemTotal) || !Number.isSafeInteger(cost)) return unavailable("economic_input_invalid");
  }
  if (itemTotal !== total) return unavailable("cart_total_mismatch");
  const revenue = total - discount + shippingRevenue;
  if (!Number.isSafeInteger(revenue)) return unavailable("economic_input_invalid");
  // Round expenses upwards; never authorize an incentive using a fractional cent saving.
  const fees = Math.ceil(Number((revenue * feeRate).toFixed(6)));
  const margin = revenue - cost - fees - shippingCost;
  if (!Number.isSafeInteger(margin)) return unavailable("economic_input_invalid");
  return { definition: INCENTIVE_MARGIN_DEFINITION, status: "estimated", reason: "known_cost_fee_assumption",
    revenueCents: revenue, productCostCents: cost, paymentFeesCents: fees,
    shippingCostCents: shippingCost, marginCents: margin,
    marginPercent: revenue > 0 ? margin / revenue : null };
}

export function meetsMarginFloor(margin: IncentiveMargin, minimumPercent: number): boolean {
  if (!Number.isFinite(minimumPercent) || minimumPercent < 0 || minimumPercent > 100 ||
      margin.marginCents === null || margin.revenueCents === null || margin.revenueCents <= 0) return false;
  const requiredCents = Math.ceil(Number((margin.revenueCents * minimumPercent / 100).toFixed(6)));
  return margin.marginCents >= requiredCents;
}
