import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import { moneyCents } from "@zyon/rules-engine";
import { z } from "zod";
import { extractOptionGroups, resolveSelectedOptions, FoodOptionValidationError } from "../../../modules/storefront/domain/food-options.js";
import { validateFoodMetadata, foodSelectionLimits } from "../../../modules/catalog/domain/services/food-options-validation.js";

const ref = z.string().min(1).max(191);
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sourceLine = z.object({ variantId: ref, productId: ref, sku: ref, quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unitPriceCents: cents, selectedOptions: z.array(z.object({ itemId: ref }).passthrough()).optional(),
  selectedServiceSlot: z.object({ slotId: ref }).optional() });
const lines = z.array(sourceLine).min(1).max(100);
const budget = z.strictObject({ version: z.literal(1), originalSubtotalCents: cents, promotionDiscountCents: cents });
const catalogSchema = z.object({ id: ref, productId: ref, sku: ref, isActive: z.literal(true),
  product: z.object({ id: ref, merchantId: ref, isActive: z.literal(true), deletedAt: z.null(), metadata: z.unknown() }),
  price: z.object({ variantId: ref, basePriceInCents: cents, currency: z.literal("BRL") }) });
type Source = Readonly<{ items: unknown; total: number }>;
type Matched = { source: z.infer<typeof sourceLine>; checkout: Cart["items"][number]; optionIds: string[]; base: number; projected: number };
function conflict(): never { throw new Error("checkout_coupon_binding_conflict"); }
function checked<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input); return parsed.success ? parsed.data : conflict();
}
function money(value: unknown): number { const result = moneyCents(value); return result === null ? conflict() : result; }
function identity(variantId: string, productId: string, sku: string, quantity: number, optionIds: string[], slotId?: string) {
  if (new Set(optionIds).size !== optionIds.length) return conflict();
  return JSON.stringify([variantId, productId, sku, quantity, [...optionIds].sort(), slotId ?? null]);
}

/** Price metadata is a claim to verify. This plan alone never authorizes B,
 * coupon D, a reservation, a new quantity, a promotion or a payment. */
function plan(source: Source, cart: Cart): { kind: "nominal" | "historical"; matched: Matched[] } {
  const stored = checked(lines, source.items);
  if (!Number.isSafeInteger(source.total) || source.total < 0
    || stored.reduce((sum, line) => sum + BigInt(line.unitPriceCents) * BigInt(line.quantity), 0n) !== BigInt(source.total)
    || !Array.isArray(cart.items) || cart.items.length !== stored.length) return conflict();
  const sources = new Map(stored.map(line => [identity(line.variantId, line.productId, line.sku, line.quantity,
    (line.selectedOptions ?? []).map(option => option.itemId), line.selectedServiceSlot?.slotId), line]));
  if (sources.size !== stored.length) return conflict();
  const seen = new Set<string>();
  const matched = cart.items.map(checkout => {
    let optionIds: string[] = [];
    if (checkout.variant !== undefined) {
      let raw: unknown; try { raw = JSON.parse(checkout.variant); } catch { return conflict(); }
      const parsed = checked(z.tuple([ref, z.array(ref)]), raw);
      if (parsed[0] !== checkout.variantId) return conflict(); optionIds = parsed[1];
    } else if (checkout.selected_options?.length) return conflict();
    const key = identity(checked(ref, checkout.variantId), checked(ref, checkout.product_id), checked(ref, checkout.sku),
      checked(z.number().int().positive().max(Number.MAX_SAFE_INTEGER), checkout.quantity), optionIds, checkout.fulfillmentSchedule?.slotId);
    const saved = sources.get(key); if (!saved || seen.has(key)) return conflict(); seen.add(key);
    return { source: saved, checkout, optionIds, base: money(checkout.originalPrice ?? checkout.price), projected: money(checkout.price) };
  });
  // Preserve nominal V1 semantics and its lack of a new catalog dependency.
  if (matched.every(line => line.source.unitPriceCents === line.base)) return { kind: "nominal", matched };
  if (cart.currency !== "BRL" || matched.some(line => line.source.unitPriceCents > line.base
    || line.projected > line.source.unitPriceCents
    || line.source.unitPriceCents < line.base && line.projected !== line.source.unitPriceCents)) return conflict();
  const original = matched.reduce((sum, line) => sum + BigInt(line.base) * BigInt(line.source.quantity), 0n);
  const projected = matched.reduce((sum, line) => sum + BigInt(line.projected) * BigInt(line.source.quantity), 0n);
  const claimed = checked(budget, cart.discountBudget);
  if (original > BigInt(Number.MAX_SAFE_INTEGER) || projected !== BigInt(money(cart.total))
    || BigInt(claimed.originalSubtotalCents) !== original || BigInt(claimed.promotionDiscountCents) !== original - projected) return conflict();
  return { kind: "historical", matched };
}

/** Internal server projection check; caller holds merchant/catalog and cart
 * fences in this actual transaction. No client, nested tx, write or grant.
 * Existing D/reservation/buyer/cap checks remain the caller's responsibility. */
export async function assertStorefrontCouponSourceProjection(tx: Prisma.TransactionClient,
  scope: Readonly<{ merchantId: string; cartId: string }>, source: Source, cart: Cart): Promise<void> {
  if (cart.source !== "storefront" || cart.cart_ref !== scope.cartId) return conflict();
  const matched = plan(source, cart); if (matched.kind === "nominal") return;
  const ids = [...new Set(matched.matched.map(line => line.source.variantId))];
  const raw = await tx.productVariant.findMany({ where: { id: { in: ids }, isActive: true,
    product: { merchantId: scope.merchantId, isActive: true, deletedAt: null } },
    select: { id: true, productId: true, sku: true, isActive: true,
      product: { select: { id: true, merchantId: true, isActive: true, deletedAt: true, metadata: true } },
      price: { select: { variantId: true, basePriceInCents: true, currency: true } } } });
  const rows = checked(z.array(catalogSchema), raw), byId = new Map(rows.map(row => [row.id, row]));
  if (rows.length !== ids.length || byId.size !== ids.length) return conflict();
  for (const line of matched.matched) {
    const row = byId.get(line.source.variantId);
    if (!row || row.product.merchantId !== scope.merchantId || row.productId !== line.source.productId || row.product.id !== row.productId
      || row.sku !== line.source.sku || row.price.variantId !== row.id || validateFoodMetadata(row.product.metadata)) return conflict();
    let options;
    try { options = resolveSelectedOptions(extractOptionGroups(row.product.metadata), line.optionIds); }
    catch (error) { if (error instanceof FoodOptionValidationError) return conflict(); throw error; }
    const groups = (row.product.metadata as { optionGroups?: Array<{ id: string; items: unknown[]; required?: boolean; selectionType?: string;
      minSelections?: number; maxSelections?: number }> } | null)?.optionGroups ?? [];
    for (const group of groups) {
      const count = options.selected.filter(option => option.groupId === group.id).length, limits = foodSelectionLimits(group);
      if (count < limits.min || count > limits.max) return conflict();
    }
    const sorted = (value: Array<{ itemId: string }>) => [...value].sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
    if (!isDeepStrictEqual(sorted(options.selected), sorted(line.source.selectedOptions ?? []))
      || row.price.basePriceInCents + options.priceModifierInCents !== line.base) return conflict();
  }
}

/** Release ONLY. Caller proves canonical frozen binding/context/fingerprint
 * and definitive payment resolution. Never use this as admission authority;
 * no current catalog is necessary to cancel an exact historical reservation. */
export function assertCapturedStorefrontCouponSourceProjection(source: Source, cart: Cart): void { plan(source, cart); }
