import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import { callStorefrontTool } from "../../domain/tools/call-storefront-tool.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { conversationBlockSchema } from "../../domain/contracts/conversation-block.schemas.js";

type PreparedCheckout = {
  checkoutPrepared: true;
  actionId: string;
  cartId: string;
  shippingPreference: "fastest" | "cheapest";
  paymentPreference: "pix" | "card";
};

type PrepareCheckout = (args: { cartId: string }) => Promise<unknown>;

type OneBuyClickCheckoutInput = {
  blocks: ConversationBlock[];
  toolsUsed: string[];
  oneBuyClickEnabled: boolean;
  cartId: string;
  createCheckoutSession: PrepareCheckout;
};

export async function appendOneBuyClickCheckout(input: OneBuyClickCheckoutInput): Promise<ConversationBlock[]> {
  if (!shouldPrepareCheckout(input)) return input.blocks;

  try {
    const args = { cartId: input.cartId };
    const checked = await callStorefrontTool("create_checkout_session", args, () => input.createCheckoutSession(args), { cartId: input.cartId });
    if (!checked.ok) return input.blocks;
    const parsed = storefrontToolOutputSchemas.create_checkout_session.safeParse(checked.data);
    return parsed.success && "checkoutPrepared" in parsed.data
      ? [...input.blocks, checkoutBlock(parsed.data)] : input.blocks;
  } catch {
    return input.blocks;
  }
}

function shouldPrepareCheckout(input: OneBuyClickCheckoutInput): boolean {
  return input.oneBuyClickEnabled
    && input.blocks.length <= 100 && input.blocks.every(block => {
      const parsed = conversationBlockSchema.safeParse(block);
      return parsed.success && (!("cartId" in parsed.data.data) || parsed.data.data.cartId === undefined || parsed.data.data.cartId === input.cartId);
    })
    && input.toolsUsed.includes("add_item_to_cart")
    && !input.toolsUsed.includes("create_checkout_session")
    && input.blocks.some(block => hasCartItems(block, input.cartId))
    && !input.blocks.some(block => block.type === "cart_add_result" && block.data.status !== "succeeded")
    && !input.blocks.some(hasPreparedCheckout);
}

function hasCartItems(block: ConversationBlock, cartId: string): boolean {
  const parsed = conversationBlockSchema.safeParse(block);
  return parsed.success && parsed.data.type === "cart_summary" && parsed.data.data.items.length > 0
    && (parsed.data.data.cartId === undefined || parsed.data.data.cartId === cartId);
}

function hasPreparedCheckout(block: ConversationBlock): boolean {
  return block.type === "checkout_prepared";
}

function checkoutBlock(prepared: PreparedCheckout): ConversationBlock {
  return {
    type: "checkout_prepared",
    data: {
      actionId: prepared.actionId,
      cartId: prepared.cartId,
      shippingPreference: prepared.shippingPreference,
      paymentPreference: prepared.paymentPreference,
    },
  };
}
