import { z } from "zod";
import type { CartHandlerDeps } from "./cart.handlers.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { CartQuantityInspection } from "../../domain/contracts/cart-quantity-inspection.schemas.js";

const id = z.string().min(1).max(191);
const itemsSchema = z.array(z.object({ productId: id, variantId: id, sku: z.string().min(1), name: z.string().min(1),
  quantity: z.number().int().min(1).max(99), selectedOptions: z.array(z.object({ itemId: id })).max(100).optional(),
  selectedServiceSlot: z.object({ slotId: id }).optional() })).max(200);
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Shares the update handler's canonical stock calculation. This is a read,
 * never a reservation or a replacement for the locked writer's revalidation. */
export async function inspectSelectedCartQuantity(deps: Pick<CartHandlerDeps, "productRepo" | "stockRepo">,
  merchantId: string, items: Array<{ productId: string; variantId: string; quantity: number }>, selected: number, quantity: number) {
  if (quantity === 0) return "admitted" as const;
  const line = items[selected]!;
  const product = await deps.productRepo.findById(merchantId, line.productId);
  if (!product || !product.isActive || product.id !== undefined && product.id !== line.productId
    || product.merchantId !== undefined && product.merchantId !== merchantId
    || !product.variants.some(variant => variant.id === line.variantId && variant.isActive)) return "product_unavailable" as const;
  if (product.type === "digital" || product.type === "service") return "admitted" as const;
  try {
    const stock = await deps.stockRepo.getAvailableStock(line.variantId);
    if (!Number.isSafeInteger(stock.quantity) || !Number.isSafeInteger(stock.reserved)
      || stock.quantity < 0 || stock.reserved < 0 || stock.reserved > stock.quantity) return "stock_validation_unavailable" as const;
    const finalQuantity = items.reduce((sum, item, index) => sum + (item.variantId === line.variantId ? index === selected ? quantity : item.quantity : 0), 0);
    if (!Number.isSafeInteger(finalQuantity) || finalQuantity < 0) return "stock_validation_unavailable" as const;
    return finalQuantity > stock.quantity - stock.reserved ? "variant_out_of_stock" as const : "admitted" as const;
  } catch { return "stock_validation_unavailable" as const; }
}

export function createCartQuantityInspectionReader(deps: Pick<CartHandlerDeps, "prisma" | "productRepo" | "stockRepo">, ctx: ToolRequestContext) {
  const { merchantId, sessionId } = ctx;
  return async (input: { cartId: string; itemReference: string; quantity: number }): Promise<CartQuantityInspection> => {
    const { cartId, itemReference, quantity } = { ...input };
    const unavailable = (): CartQuantityInspection => ({ status: "unavailable", cartId, quantity });
    if (cartId !== sessionId || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 99) return unavailable();
    try {
      // getOrCreate/getCart can upsert, refresh TTL or reprice. Admission must
      // only read the existing scoped row and never call those paths.
      const stored = await deps.prisma.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } },
        select: { merchantId: true, sessionId: true, items: true } });
      if (!stored) return { status: "rejected", code: "cart_item_not_found", cartId, quantity };
      if (stored.merchantId !== merchantId || stored.sessionId !== sessionId) return unavailable();
      const parsed = itemsSchema.safeParse(stored.items);
      if (!parsed.success) return unavailable();
      const needle = normalize(itemReference);
      if (!needle) return unavailable();
      const matches = parsed.data.flatMap((line, index) => line.variantId === itemReference || line.sku === itemReference
        || normalize(line.sku) === needle || (` ${normalize(line.name)} `).includes(` ${needle} `) ? [index] : []);
      if (matches.length !== 1) return { status: "rejected", code: matches.length ? "cart_line_selection_required" : "cart_item_not_found", cartId, quantity };
      const selected = matches[0]!, line = parsed.data[selected]!;
      const optionItemIds = (line.selectedOptions ?? []).map(option => option.itemId).sort();
      if (new Set(optionItemIds).size !== optionItemIds.length) return unavailable();
      const verdict = await inspectSelectedCartQuantity(deps, merchantId, parsed.data, selected, quantity);
      if (verdict === "stock_validation_unavailable") return unavailable();
      if (verdict !== "admitted") return { status: "rejected", code: verdict, cartId, quantity };
      return { status: "admitted", cartId, quantity, selection: { cartId, quantity, variantId: line.variantId,
        optionItemIds, serviceSlotId: line.selectedServiceSlot?.slotId ?? null } };
    } catch { return unavailable(); }
  };
}
