import { z } from "zod";

const id = z.string().min(1).max(191);
const quantity = z.number().int().min(0).max(99);
const base = { cartId: id, quantity };
export const cartQuantitySelectionSchema = z.strictObject({ ...base, variantId: id,
  optionItemIds: z.array(id).max(100).refine(ids => new Set(ids).size === ids.length), serviceSlotId: id.nullable() });
export type CartQuantitySelection = z.infer<typeof cartQuantitySelectionSchema>;
export const cartQuantityInspectionSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...base, status: z.literal("admitted"), selection: cartQuantitySelectionSchema }),
  z.strictObject({ ...base, status: z.literal("rejected"), code: z.enum(["cart_item_not_found", "cart_line_selection_required", "product_unavailable", "variant_out_of_stock"]) }),
  z.strictObject({ ...base, status: z.literal("unavailable") }),
]);
export type CartQuantityInspection = z.infer<typeof cartQuantityInspectionSchema>;
