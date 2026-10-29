import { z } from "zod";
import { conversationBlockSchema } from "./conversation-block.schemas.js";
import { storefrontIntentSchema } from "./storefront-intent.schemas.js";
import { outputMatchesStorefrontScope } from "./storefront-conversation.schemas.js";

export const storefrontStageSchema = z.enum(["welcome", "browsing", "filter", "categories", "product_detail", "more_info",
  "reviews", "review_card", "questions", "compare", "wishlist", "added_to_cart", "promotions", "post_purchase", "support"]);
export const storefrontQuickReplyListSchema = z.array(z.string().trim().min(1).max(500)).max(8);
export const storefrontQuickReplyConfigSchema = z.strictObject({
  stages: z.array(z.strictObject({ stage: storefrontStageSchema, label: z.string().max(100), replies: storefrontQuickReplyListSchema })).max(15),
  fallback: storefrontQuickReplyListSchema,
}).refine(config => new Set(config.stages.map(stage => stage.stage)).size === config.stages.length);
export const storefrontQuickReplyMapSchema = z.partialRecord(storefrontStageSchema, storefrontQuickReplyListSchema);
export const storefrontQuickReplyCartSchema = z.object({
  items: z.array(z.object({ variantId: z.string().min(1).max(191), name: z.string().max(24000), quantity: z.number().int().positive() })).max(200),
  total: z.number().nonnegative(), itemCount: z.number().int().nonnegative(), couponCode: z.string().max(100).nullable().optional(),
}).refine(cart => cart.itemCount === cart.items.reduce((sum, item) => sum + item.quantity, 0));

export const storefrontPresentationContextSchema = z.strictObject({
  mode: z.literal("structured"), source: z.enum(["structured", "fallback"]).optional(), intent: storefrontIntentSchema.optional(),
  merchantId: z.string().min(1).max(191), cartId: z.string().min(1).max(191),
  blocks: z.array(conversationBlockSchema).max(100),
}).refine(context => outputMatchesStorefrontScope({ message: "presentation", blocks: context.blocks }, context));

export type StorefrontPresentationContext = z.infer<typeof storefrontPresentationContextSchema>;
export type StorefrontStage = z.infer<typeof storefrontStageSchema>;

