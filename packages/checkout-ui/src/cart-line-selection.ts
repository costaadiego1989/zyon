import type { CartItemData, CartLineSelection } from "./types";
export function cartItemDisplayName(item: CartItemData): string {
  return item.selectionLabel ? `${item.productName} — ${item.selectionLabel}` : item.productName;
}

export function cartItemSelection(item: CartItemData): CartLineSelection | undefined {
  if (item.optionItemIds === undefined && item.serviceSlotId === undefined) return undefined;
  return { ...(item.optionItemIds === undefined ? {} : { optionItemIds: [...item.optionItemIds] }),
    ...(item.serviceSlotId === undefined ? {} : { serviceSlotId: item.serviceSlotId }) };
}
export function cartItemLineKey(item: CartItemData): string {
  return JSON.stringify([item.variantId, item.optionItemIds === undefined ? null : [...item.optionItemIds].sort(), item.serviceSlotId ?? null]);
}
