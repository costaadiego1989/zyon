import { assertCrossSellRequestScope, parseCrossSellSelection } from "./cross-sell-quote";
import type { CrossSellBuyerScope, CrossSellDisplayProduct } from "./storefront-cross-sell-flow";
import type { ProductContentPurchaseResponse } from "./api/product-content";

export type CrossSellDetailContext = { key: string; scope: CrossSellBuyerScope; productId: string; initialVariantId: string;
  source: CrossSellDisplayProduct; placement: string };
export type CrossSellDetailPurchase = { context: CrossSellDetailContext; scopeKey: string;
  isCurrent: () => boolean; prepare: (products: readonly CrossSellDisplayProduct[]) => Promise<void>;
  present: (products: readonly CrossSellDisplayProduct[]) => CrossSellDisplayProduct[];
  accept: (product: CrossSellDisplayProduct, guard?: () => boolean) => Promise<boolean> };
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
export function isCrossSellDetailCurrent(context: CrossSellDetailContext, now: {
  context: CrossSellDetailContext | null; productId?: string | null; blocked: boolean;
  merchantId?: string; conversationId: string | null; cartId?: string | null;
}): boolean {
  return now.context === context && now.productId === context.productId && !now.blocked
    && now.merchantId === context.scope.merchantId && now.conversationId === context.scope.conversationId && now.cartId === context.scope.cartId;
}
/** A history marker denies a silent ordinary fallback; it grants no authority. */
export function crossSellDetailRequiresRecovery(ready: boolean, markerProductId: string | null, productId: string): boolean {
  return !ready || markerProductId === productId;
}
export function createCrossSellDetailContext(scope: CrossSellBuyerScope, source: CrossSellDisplayProduct, placement: string): CrossSellDetailContext {
  assertCrossSellRequestScope(scope.merchantId, scope.cartId, scope.conversationId);
  if (!validId(source.productId) || source.couponCode || !validId(source.promoId)) throw new Error("cross_sell_detail_unavailable");
  parseCrossSellSelection({ variantId: source.id, promotionId: source.promoId, quantity: 1,
    ...(source.selectedOptionItemIds === undefined ? {} : { selectedOptionItemIds: source.selectedOptionItemIds }) });
  return { key: JSON.stringify([scope.merchantId, scope.cartId, placement, source.productId, source.id, source.promoId]),
    scope: { ...scope }, productId: source.productId, initialVariantId: source.id, source: structuredClone(source), placement };
}
export function selectCrossSellDetailCandidate(context: CrossSellDetailContext, purchase: ProductContentPurchaseResponse,
  variantId: string, optionIds: readonly string[]): { kind: "incomplete" | "unavailable" } | { kind: "selected"; product: CrossSellDisplayProduct } {
  if (!Array.isArray(purchase.variants) || purchase.variants.some(variant => !variant || typeof variant !== "object" || !validId(variant.id))
    || !purchase.variants.some(variant => variant.id === context.initialVariantId)
    || !Array.isArray(purchase.optionGroups)) return { kind: "unavailable" };
  const variant = purchase.variants.find(variant => variant.id === variantId);
  try { parseCrossSellSelection({ variantId, promotionId: context.source.promoId, quantity: 1, selectedOptionItemIds: [...optionIds] }); }
  catch { return { kind: "unavailable" }; }
  if (!variant?.available || variant.currency !== "BRL" || typeof variant.priceReais !== "number" || !Number.isFinite(variant.priceReais) || variant.priceReais < 0) return { kind: "unavailable" };
  const groups = purchase.optionGroups;
  if (groups.some(group => !group || !validId(group.id) || typeof group.name !== "string" || typeof group.required !== "boolean"
    || !["single", "multiple"].includes(group.selectionType) || !Array.isArray(group.items)
    || group.items.some(item => !item || !validId(item.id) || typeof item.name !== "string" || !Number.isSafeInteger(item.priceModifierInCents)))) return { kind: "unavailable" };
  const allIds = groups.flatMap(group => group.items.map(item => item.id));
  if (new Set(allIds).size !== allIds.length) return { kind: "unavailable" };
  if (optionIds.some(id => !groups.some(group => group.items.some(item => item.id === id)))) return { kind: "unavailable" };
  if (groups.some(group => group.selectionType === "single" && group.items.filter(item => optionIds.includes(item.id)).length > 1)) return { kind: "unavailable" };
  if (groups.some(group => group.required && !group.items.some(item => optionIds.includes(item.id)))) return { kind: "incomplete" };
  const attributes = Object.values(variant.attributes ?? {}).filter(value => typeof value === "string" && value.trim());
  return { kind: "selected", product: { id: variantId, productId: context.productId,
    name: `${purchase.productName}${attributes.length ? ` — ${attributes.join(" / ")}` : ""}`,
    price: variant.priceReais, priceFormatted: "Confira a oferta", inStock: true, promoId: context.source.promoId,
    ...(context.source.image ? { image: context.source.image } : {}), selectedOptionItemIds: [...optionIds].sort() } };
}
