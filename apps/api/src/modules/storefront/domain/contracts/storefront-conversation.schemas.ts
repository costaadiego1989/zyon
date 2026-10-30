import { z } from "zod";
import { conversationBlockSchema } from "./conversation-block.schemas.js";
import { storefrontUiActionSchema } from "./storefront-ui-action.schemas.js";
import { storefrontSuggestedReadActionsSchema } from "./storefront-suggested-read-actions.schemas.js";

export const STOREFRONT_CONVERSATION_CONTRACT_VERSION = 1;
export const STOREFRONT_CONTRACT_FALLBACK = "Não consegui confirmar a resposta agora. Confira seu carrinho antes de tentar novamente.";
const id = z.string().min(1).max(191);
const message = z.string().max(4000).refine(value => value.trim().length > 0);
const history = z.array(z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(100);
const attachment = z.string().max(24000).optional();
const identity = z.strictObject({ agentName: z.string().max(200).optional(), persona: z.string().max(4000).optional(),
  tone: z.string().max(200).optional(), greeting: z.string().max(4000).optional(), language: z.string().max(80).optional() });
const buyer = z.strictObject({ globalUserId: id, name: z.string().max(200).optional(),
  phone: z.string().max(40).optional(), email: z.string().max(320).optional() });
export const oneBuyClickContextSchema = z.strictObject({ enabled: z.boolean(),
  status: z.enum(["idle", "resolving", "awaiting_choice", "ready_for_payment", "handed_off", "paused", "failed", "completed"]),
  shippingPreference: z.enum(["fastest", "cheapest"]), paymentPreference: z.enum(["pix", "card"]) });
export const storefrontDeferredContextSchema = z.strictObject({
  attachmentContext: attachment, oneBuyClick: oneBuyClickContextSchema.optional(),
});
export const storefrontPreparedContextSchema = storefrontDeferredContextSchema.extend({
  knowledgeContext: z.string().max(80000).optional(),
});
const uiAction = storefrontUiActionSchema;
const policy = z.strictObject({ maxDiscountPercent: z.number().min(0).max(100).optional(),
  allowFreeShipping: z.boolean().optional(), allowShippingDiscount: z.boolean().optional(),
  allowStackDiscountAndFreeShipping: z.boolean().optional(),
  freeShippingMinCartValue: z.number().nonnegative().optional(), maxPartialShippingDiscount: z.number().min(0).max(100).optional(),
  offerExpirationMinutes: z.number().int().positive().optional() });

export const sendStoreMessageInputSchema = z.strictObject({
  merchant_id: id, conversation_id: id, user_message: message, cart_id: id.optional(), global_user_id: id.optional(),
  history: history.optional(), attachment_context: attachment, device_type: z.enum(["mobile", "tablet", "desktop"]).optional(),
  one_buy_click: oneBuyClickContextSchema.optional(), ui_action: uiAction.optional(), trusted_buyer_context: buyer.optional(),
});

export const storefrontConversationInputSchema = z.strictObject({
  userMessage: message, merchantId: id, sessionId: id, cartId: id.optional(), history,
  attachmentContext: attachment, merchantName: z.string().max(500).optional(), storeCategory: z.string().min(1).max(200),
  storeSettings: z.record(z.string(), z.json()).optional(), agentIdentity: identity.optional(), merchantPolicy: policy.optional(),
  advancedRules: z.array(z.string().max(8000)).max(200).optional(), experimentSystemPrompt: z.string().max(24000).optional(),
  buyerContext: buyer.optional(), oneBuyClick: oneBuyClickContextSchema.optional(),
  deviceType: z.enum(["mobile", "tablet", "desktop"]).optional(), messageFormat: z.literal("whatsapp").optional(), uiAction: uiAction.optional(),
});

export const storefrontConversationOutputSchema = z.strictObject({
  message: z.string().max(8000).refine(value => value.trim().length > 0),
  blocks: z.array(conversationBlockSchema).max(100), cartId: id.optional(),
  suggestedNext: z.array(z.string().min(1).max(500)).max(50).optional(),
});

export const sendStoreMessageOutputSchema = z.strictObject({
  message: storefrontConversationOutputSchema.shape.message,
  blocks: storefrontConversationOutputSchema.shape.blocks,
  cart_id: id.optional(), conversation_id: id, suggested_next: z.array(z.string().min(1).max(500)).max(50),
  suggested_actions: storefrontSuggestedReadActionsSchema.optional(),
});

/** Pin structured response references to the server's current conversation scope. */
export function outputMatchesStorefrontScope(output: z.infer<typeof storefrontConversationOutputSchema>,
  scope: { merchantId: string; cartId: string }): boolean {
  if (output.cartId !== undefined && output.cartId !== scope.cartId) return false;
  return output.blocks.every(block => {
    if ((block.type === "cart_summary" || block.type === "cart_add_result" || block.type === "checkout_prepared")
      && block.data.cartId !== undefined && block.data.cartId !== scope.cartId) return false;
    return block.type !== "product_carousel" || block.data.merchantId === undefined || block.data.merchantId === scope.merchantId;
  });
}

