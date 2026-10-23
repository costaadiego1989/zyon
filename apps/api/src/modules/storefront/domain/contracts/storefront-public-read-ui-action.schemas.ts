import { z } from "zod";
import type { StorefrontReadUiAction, StorefrontReadUiActionCapability } from "@zyon/shared-types";

const id = z.string().min(1).max(191).refine(value => value.trim().length > 0);

/** Public transport is deliberately narrower than the internal UI executor. */
export const storefrontPublicReadUiActionSchema: z.ZodType<StorefrontReadUiAction> = z.discriminatedUnion("tool", [
  z.strictObject({ tool: z.literal("search_products"), args: z.strictObject({
    query: z.literal("*"), categoryId: id, cursor: z.string().max(2048).optional(),
  }) }),
  z.strictObject({ tool: z.literal("get_product_details"), args: z.strictObject({ productId: id }) }),
]);

export const storefrontPublicReadUiActionRequestSchema = z.strictObject({
  ui_action_version: z.literal(1),
  ui_action: storefrontPublicReadUiActionSchema,
  user_message: z.string().max(4000).refine(value => value.trim().length > 0),
});

/** Fresh metadata avoids shared mutable arrays between response objects. */
export function storefrontReadUiActionCapability(): StorefrontReadUiActionCapability {
  return { version: 1, tools: ["search_products", "get_product_details"] };
}

