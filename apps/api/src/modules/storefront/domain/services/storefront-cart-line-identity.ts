import type { StorefrontCartItem, StorefrontCartLineSelector } from "../ports/storefront-cart.port.js";
import { storefrontCartLineSelectorSchema } from "../contracts/storefront-cart-line-selector.schemas.js";

export class StorefrontCartLineSelectionError extends Error {
  constructor(code = "cart_option_line_selection_required") { super(code); }
}
/** IDs, never labels/prices, identify a canonical selection. Ordering is immaterial. */
export function storefrontCartLineIdentity(item: Pick<StorefrontCartItem, "variantId" | "selectedOptions" | "selectedServiceSlot">): string {
  const ids = (item.selectedOptions ?? []).map(option => option.itemId);
  if (new Set(ids).size !== ids.length) throw new StorefrontCartLineSelectionError("cart_line_selection_invalid");
  return JSON.stringify([item.variantId, ids.sort(), item.selectedServiceSlot?.slotId ?? null]);
}
export function storefrontCartLineSelectionLabel(item: Pick<StorefrontCartItem, "selectedOptions" | "selectedServiceSlot">): string | undefined {
  const labels = (item.selectedOptions ?? []).map(option => `${option.groupName}: ${option.itemName}`);
  if (item.selectedServiceSlot) labels.push(`${item.selectedServiceSlot.date} ${item.selectedServiceSlot.startTime}`);
  return labels.length ? labels.join(" · ") : undefined;
}
/** Undefined selector preserves unique-variant legacy calls, not a wildcard grant.
 * The caller uses the index only inside its locked canonical cart transaction. */
export function selectStorefrontCartLine(items: StorefrontCartItem[], variantId: string, selector?: StorefrontCartLineSelector): number | undefined {
  const parsed = selector === undefined ? undefined : storefrontCartLineSelectorSchema.safeParse(selector);
  if (parsed && !parsed.success) throw new StorefrontCartLineSelectionError("cart_line_selection_invalid");
  const selection = parsed?.data;
  const optionKey = selection?.optionItemIds === undefined ? undefined : JSON.stringify([...selection.optionItemIds].sort());
  const matches = items.flatMap((item, index) => {
    if (item.variantId !== variantId) return [];
    storefrontCartLineIdentity(item); // Reject malformed persisted identities, never choose arbitrarily.
    if (optionKey !== undefined && JSON.stringify((item.selectedOptions ?? []).map(option => option.itemId).sort()) !== optionKey) return [];
    if (selection?.serviceSlotId !== undefined && (item.selectedServiceSlot?.slotId ?? null) !== selection.serviceSlotId) return [];
    return [index];
  });
  if (matches.length > 1) throw new StorefrontCartLineSelectionError();
  return matches[0];
}
