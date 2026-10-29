import { z } from "zod";
import type { StorefrontPublicUiAction, StorefrontReadUiActionCapability } from "@zyon/shared-types";

const id = z.string().min(1).max(191).refine(value => value.trim().length > 0);

/** Catalog suggestions remain read-only, including after explicit question submission is enabled. */
export const storefrontCatalogReadUiActionSchema = z.discriminatedUnion("tool", [
  z.strictObject({ tool: z.literal("search_products"), args: z.strictObject({
    query: z.literal("*"), categoryId: id, cursor: z.string().max(2048).optional(),
  }) }),
  z.strictObject({ tool: z.literal("get_product_details"), args: z.strictObject({ productId: id }) }),
]);

/** Public transport is deliberately narrower than the internal UI executor. */
export const storefrontPublicReadUiActionSchema: z.ZodType<StorefrontPublicUiAction> = z.discriminatedUnion("tool", [
  ...storefrontCatalogReadUiActionSchema.options,
  z.strictObject({ tool: z.literal("get_product_questions"), args: z.strictObject({ productId: id,
    filter: z.enum(["answered", "unanswered", "mine"]).optional() }) }),
  z.strictObject({ tool: z.literal("ask_product_question"), args: z.strictObject({ productId: id }) }),
  z.strictObject({ tool: z.literal("create_question"), args: z.strictObject({ productId: id,
    question: z.string().max(4000).refine(value => value.trim().length > 0) }) }),
]);

export const storefrontPublicReadUiActionRequestSchema = z.strictObject({
  ui_action_version: z.literal(1),
  ui_action: storefrontPublicReadUiActionSchema,
  user_message: z.string().max(4000).refine(value => value.trim().length > 0),
});

/** Fresh metadata avoids shared mutable arrays between response objects. */
export function storefrontReadUiActionCapability(): StorefrontReadUiActionCapability {
  return { version: 1, tools: ["search_products", "get_product_details", "get_product_questions", "ask_product_question", "create_question"] };
}

