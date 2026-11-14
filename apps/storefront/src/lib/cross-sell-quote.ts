import type { CommercialNotice } from "@zyon/shared-types";

// Browser mirror of cross-sell-storefront-quote.schemas.ts. No Zod dependency
// exists in this app. These checks are display/precondition guards, NOT authority.
export type CrossSellSelectedOption = { groupId: string; groupName: string; itemId: string; itemName: string; priceModifierInCents: number };
export type CrossSellSelection = { variantId: string; promotionId: string; quantity: number; selectedOptionItemIds?: string[] };
type Intent = { version: 1; promotionId: string; promotionUpdatedAt: string; acceptedQuantity: number; originalUnitPriceCents: number; maximumUnitPriceCents: number; selectedOptionItemIds?: string[] };
type BasisItem = { variantId: string; productId: string; sku: string; name: string; categoryId?: string; quantity: number; unitPriceCents: number; imageUrl?: string; selectedOptions?: CrossSellSelectedOption[]; crossSellIntent?: Intent };
export type CrossSellQuote = CrossSellSelection & {
  version: 1; merchantId: string; cartId: string; productId: string; sku: string; promotionUpdatedAt: string;
  originalUnitPriceCents: number; maximumUnitPriceCents: number;
  selectedOptions?: CrossSellSelectedOption[];
  cartBasis: { items: BasisItem[]; total: number; discount: number; couponCode: null; freeShipping: false };
  quote: { currency: "BRL"; originalSubtotalCents: number; promotionDiscountCents: number; subtotalCents: number; merchandiseTotalCents: number;
    items: Array<{ variantId: string; productId: string; quantity: number; baseUnitPriceCents: number; unitPriceCents: number; selectedOptionItemIds?: string[] }>; commercialNotices?: CommercialNotice[] };
};
export type CrossSellAcceptance = { version: 1; status: "accepted"; merchantId: string; cartId: string };
function fail(): never { throw new Error("invalid_cross_sell_quote"); }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function object(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();
}
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 191 && value.trim().length > 0
  && !value.includes("\0") && !Array.from(value).some(char => { const point = char.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff; });
const cents = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
const quantity = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
function optionIds(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 250 || !value.every(id) || new Set(value).size !== value.length) fail();
}
function options(value: unknown): asserts value is CrossSellSelectedOption[] {
  if (!Array.isArray(value) || value.length > 250) fail();
  for (const option of value) {
    object(option, ["groupId", "groupName", "itemId", "itemName", "priceModifierInCents"]);
    if (!id(option.groupId) || !id(option.itemId) || !text(option.groupName, 200) || !text(option.itemName, 200) || !cents(option.priceModifierInCents)) fail();
  }
  if (new Set(value.map(option => option.itemId)).size !== value.length) fail();
}
export const crossSellOptionIdentity = (line: { variantId: string; selectedOptionItemIds?: readonly string[]; selectedOptions?: readonly { itemId: string }[] }) =>
  JSON.stringify([line.variantId, [...(line.selectedOptionItemIds ?? line.selectedOptions?.map(option => option.itemId) ?? [])].sort()]);
function instant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month! >= 1 && month! <= 12 && day! >= 1 && day! <= days[month! - 1]!;
}
// Preserve keys with undefined values so strict validation rejects unknown
// fields rather than silently dropping them through JSON.stringify first.
function snapshot(value: unknown, parents = new Set<object>(), depth = 0): unknown {
  if (depth > 12) return fail();
  if (value === null || typeof value !== "object") return value;
  if (parents.has(value)) return fail();
  parents.add(value);
  const copied = Array.isArray(value) ? value.map(item => snapshot(item, parents, depth + 1))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, parents, depth + 1)]));
  parents.delete(value);
  return copied;
}
function intent(value: unknown): void {
  object(value, ["version", "promotionId", "promotionUpdatedAt", "acceptedQuantity", "originalUnitPriceCents", "maximumUnitPriceCents", "selectedOptionItemIds"]);
  if (value.selectedOptionItemIds !== undefined) optionIds(value.selectedOptionItemIds);
  if (value.version !== 1 || !id(value.promotionId) || !instant(value.promotionUpdatedAt) || !quantity(value.acceptedQuantity)
    || !Number.isSafeInteger(value.originalUnitPriceCents) || (value.originalUnitPriceCents as number) < 0 || !cents(value.maximumUnitPriceCents)
    || value.maximumUnitPriceCents > (value.originalUnitPriceCents as number)) fail();
}
function notices(value: unknown): void {
  if (!Array.isArray(value) || value.length > 5) fail();
  for (const item of value) {
    object(item, ["version", "code", "message"]);
    if (item.version !== 1 || typeof item.code !== "string" || !["discount_limit_reached", "discount_limited", "discount_unavailable", "benefit_not_combinable", "benefit_conditions_not_met"].includes(item.code)
      || !text(item.message, 1000) || !item.message.trim()) fail();
  }
}
export function parseCrossSellSelection(input: unknown): CrossSellSelection {
  const value = snapshot(input); object(value, ["variantId", "promotionId", "quantity", "selectedOptionItemIds"]);
  if (value.selectedOptionItemIds !== undefined) optionIds(value.selectedOptionItemIds);
  if (!id(value.variantId) || !id(value.promotionId) || !quantity(value.quantity)) fail();
  return value as CrossSellSelection;
}
export function parseCrossSellQuote(input: unknown): CrossSellQuote {
  const value = snapshot(input);
  object(value, ["version", "merchantId", "cartId", "variantId", "productId", "sku", "promotionId", "promotionUpdatedAt", "quantity", "originalUnitPriceCents", "maximumUnitPriceCents", "selectedOptionItemIds", "selectedOptions", "cartBasis", "quote"]);
  if (value.selectedOptionItemIds !== undefined) optionIds(value.selectedOptionItemIds);
  if (value.selectedOptions !== undefined) options(value.selectedOptions);
  if (value.version !== 1 || ![value.merchantId, value.cartId, value.variantId, value.productId, value.sku, value.promotionId].every(id)
    || !instant(value.promotionUpdatedAt) || !quantity(value.quantity) || !cents(value.originalUnitPriceCents) || !cents(value.maximumUnitPriceCents)
    || value.maximumUnitPriceCents > value.originalUnitPriceCents) fail();
  const basis = value.cartBasis; object(basis, ["items", "total", "discount", "couponCode", "freeShipping"]);
  if (!Array.isArray(basis.items) || basis.items.length > 199 || !cents(basis.total) || !cents(basis.discount) || basis.couponCode !== null || basis.freeShipping !== false) fail();
  const basisIds = new Set<string>(); let basisSum = 0n;
  for (const item of basis.items) {
    object(item, ["variantId", "productId", "sku", "name", "categoryId", "quantity", "unitPriceCents", "imageUrl", "selectedOptions", "crossSellIntent"]);
    if (item.selectedOptions !== undefined) options(item.selectedOptions);
    if (!id(item.variantId) || !id(item.productId) || !id(item.sku) || !text(item.name, 1000) || !quantity(item.quantity) || !cents(item.unitPriceCents)
      || item.categoryId !== undefined && !id(item.categoryId) || item.imageUrl !== undefined && !text(item.imageUrl, 2048)
      || basisIds.has(crossSellOptionIdentity(item as unknown as BasisItem)) || item.variantId === value.variantId) fail();
    if (item.crossSellIntent !== undefined) intent(item.crossSellIntent);
    basisIds.add(crossSellOptionIdentity(item as unknown as BasisItem)); basisSum += BigInt(item.quantity) * BigInt(item.unitPriceCents);
  }
  if (basisSum !== BigInt(basis.total)) fail();
  const quote = value.quote; object(quote, ["currency", "originalSubtotalCents", "promotionDiscountCents", "subtotalCents", "merchandiseTotalCents", "items", "commercialNotices"]);
  if (quote.currency !== "BRL" || ![quote.originalSubtotalCents, quote.promotionDiscountCents, quote.subtotalCents, quote.merchandiseTotalCents].every(cents)
    || !Array.isArray(quote.items) || quote.items.length < 1 || quote.items.length > 200 || quote.items.length !== basis.items.length + 1) fail();
  if (quote.commercialNotices !== undefined) notices(quote.commercialNotices);
  const quoteIds = new Set<string>(); let original = 0n, effective = 0n;
  for (const item of quote.items) {
    object(item, ["variantId", "productId", "quantity", "baseUnitPriceCents", "unitPriceCents", "selectedOptionItemIds"]);
    if (item.selectedOptionItemIds !== undefined) optionIds(item.selectedOptionItemIds);
    if (!id(item.variantId) || !id(item.productId) || !quantity(item.quantity) || !cents(item.baseUnitPriceCents) || !cents(item.unitPriceCents)
      || item.unitPriceCents > item.baseUnitPriceCents || quoteIds.has(crossSellOptionIdentity(item as unknown as CrossSellQuote["quote"]["items"][number]))) fail();
    quoteIds.add(crossSellOptionIdentity(item as unknown as CrossSellQuote["quote"]["items"][number])); original += BigInt(item.baseUnitPriceCents) * BigInt(item.quantity); effective += BigInt(item.unitPriceCents) * BigInt(item.quantity);
  }
  const parsed = value as unknown as CrossSellQuote;
  const target = parsed.quote.items.find(item => item.variantId === parsed.variantId);
  if (!target || crossSellOptionIdentity(parsed) !== crossSellOptionIdentity({ variantId: parsed.variantId, selectedOptions: parsed.selectedOptions })
    || crossSellOptionIdentity(parsed) !== crossSellOptionIdentity(target)
    || target.productId !== parsed.productId || target.quantity !== parsed.quantity || target.baseUnitPriceCents !== parsed.originalUnitPriceCents
    || target.unitPriceCents !== parsed.maximumUnitPriceCents || original !== BigInt(parsed.quote.originalSubtotalCents)
    || effective !== BigInt(parsed.quote.subtotalCents) || original - effective !== BigInt(parsed.quote.promotionDiscountCents)
    || parsed.quote.merchandiseTotalCents > parsed.quote.subtotalCents
    || parsed.cartBasis.items.some(item => !parsed.quote.items.some(line => crossSellOptionIdentity(line) === crossSellOptionIdentity(item) && line.productId === item.productId
      && line.quantity === item.quantity && line.baseUnitPriceCents === item.unitPriceCents))) fail();
  return parsed;
}
export function assertCrossSellQuoteScope(quote: CrossSellQuote, merchantId: string, cartId: string, selection?: CrossSellSelection): void {
  if (!id(merchantId) || !id(cartId) || quote.merchantId !== merchantId || quote.cartId !== cartId
    || selection && (quote.variantId !== selection.variantId || quote.promotionId !== selection.promotionId || quote.quantity !== selection.quantity
      || crossSellOptionIdentity(quote) !== crossSellOptionIdentity(selection))) fail();
}
/** Current routes bind the cart to its signed conversation. Never remap IDs or
 * create a replacement conversation to make an old request appear valid. */
export function assertCrossSellRequestScope(merchantId: string, cartId: string, conversationId: string): void {
  if (!id(merchantId) || !id(cartId) || !id(conversationId) || cartId !== conversationId) fail();
}
export function parseCrossSellAcceptance(input: unknown, merchantId: string, cartId: string): CrossSellAcceptance {
  const value = snapshot(input); object(value, ["version", "status", "merchantId", "cartId"]);
  if (value.version !== 1 || value.status !== "accepted" || !id(value.merchantId) || !id(value.cartId) || value.merchantId !== merchantId || value.cartId !== cartId) fail();
  return value as CrossSellAcceptance;
}
