import { normalCheckoutCrossSellTargetSelectionSchema } from "@zyon/contracts";
import type { CheckoutProductDetailRequest, CheckoutProductSelection } from "@zyon/widget-v2";
import type { ProductContentPurchaseResponse } from "./api/product-content";

export type CheckoutProductDetailPurchase = { request: CheckoutProductDetailRequest; close: () => void };
/** Catalog display data selects identities only. The backend quote revalidates
 * eligibility, paid additions, price, stock and promotion; never a UI grant. */
export function selectCheckoutProductDetail(context: Pick<CheckoutProductDetailRequest, "initialVariantId" | "initialSku">,
  purchase: ProductContentPurchaseResponse, variantId: string, optionIds: readonly string[]):
  { kind: "incomplete" | "unavailable" } | { kind: "selected"; selection: CheckoutProductSelection } {
  if (!purchase || !Array.isArray(purchase.variants) || purchase.variants.some(value => !value || typeof value.id !== "string")
    || !purchase.variants.some(value => value.id === context.initialVariantId && value.sku === context.initialSku)
    || !Array.isArray(purchase.optionGroups) || new Set(optionIds).size !== optionIds.length) return { kind: "unavailable" };
  const variant = purchase.variants.find(value => value.id === variantId);
  if (!variant?.available || variant.currency !== "BRL") return { kind: "unavailable" };
  const groups = purchase.optionGroups;
  if (groups.some(group => !group || typeof group.id !== "string" || typeof group.required !== "boolean" || !["single", "multiple"].includes(group.selectionType)
    || !Array.isArray(group.items) || group.items.some(item => !item || typeof item.id !== "string" || !Number.isSafeInteger(item.priceModifierInCents) || item.priceModifierInCents < 0))
    || optionIds.some(id => !groups.some(group => group.items.some(item => item.id === id)))
    || groups.some(group => group.selectionType === "single" && group.items.filter(item => optionIds.includes(item.id)).length > 1)) return { kind: "unavailable" };
  const knownIds = groups.flatMap(group => group.items.map(item => item.id));
  if (new Set(knownIds).size !== knownIds.length) return { kind: "unavailable" };
  if (groups.some(group => group.required && !group.items.some(item => optionIds.includes(item.id)))) return { kind: "incomplete" };
  const parsed = normalCheckoutCrossSellTargetSelectionSchema.safeParse({ sku: variant.sku, variant_id: variantId, quantity: 1, selected_option_item_ids: [...optionIds].sort() });
  return parsed.success ? { kind: "selected", selection: { sku: parsed.data.sku, variantId: parsed.data.variant_id,
    quantity: parsed.data.quantity, selectedOptionItemIds: parsed.data.selected_option_item_ids ?? [] } } : { kind: "unavailable" };
}
