import type { NormalCheckoutCrossSellQuote, NormalCheckoutCrossSellTargetSelection } from "@zyon/contracts";

export interface StandaloneCrossSellProduct {
  sku?: string; variantId?: string; suggestionId?: string; inStock?: boolean;
  optionGroups?: unknown;
  option_groups?: unknown;
}
/** Absence of required-option metadata is NOT permission: the canonical quote
 * endpoint must still validate the empty selection before a price is shown. */
export function standaloneCrossSellSelection(product: StandaloneCrossSellProduct): NormalCheckoutCrossSellTargetSelection | null {
  if (!product.sku || !product.variantId || !product.suggestionId || product.inStock === false) return null;
  for (const groups of [product.optionGroups, product.option_groups]) {
    if (groups !== undefined && (!Array.isArray(groups) || groups.some((group: unknown) => group === null || typeof group !== "object"
      || "required" in group && group.required !== undefined && group.required !== false))) return null;
  }
  return { sku: product.sku, variant_id: product.variantId, quantity: 1, selected_option_item_ids: [] };
}
export function standaloneCrossSellCardKey(product: StandaloneCrossSellProduct): string {
  return JSON.stringify([product.suggestionId ?? null, product.sku ?? null, product.variantId ?? null]);
}
export function standaloneCrossSellPrice(quote: NormalCheckoutCrossSellQuote,
  selection: NormalCheckoutCrossSellTargetSelection): number | null {
  if (quote.pricing.targets.length !== 1) return null;
  const target = quote.pricing.targets[0]!;
  if (target.sku !== selection.sku || target.variantId !== selection.variant_id || target.acceptedQuantity !== selection.quantity
    || JSON.stringify([...(target.selectedOptionItemIds ?? [])].sort()) !== JSON.stringify([...(selection.selected_option_item_ids ?? [])].sort())) return null;
  return target.maximumUnitPriceCents / 100;
}
