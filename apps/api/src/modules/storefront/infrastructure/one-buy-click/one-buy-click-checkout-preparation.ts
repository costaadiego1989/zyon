import type { ConversationBlock } from "../../domain/types/conversation-block.js";

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
    const prepared = await input.createCheckoutSession({ cartId: input.cartId });
    return isPreparedCheckout(prepared)
      ? [...input.blocks, checkoutBlock(prepared)]
      : input.blocks;
  } catch {
    return input.blocks;
  }
}

function shouldPrepareCheckout(input: OneBuyClickCheckoutInput): boolean {
  return input.oneBuyClickEnabled
    && input.toolsUsed.includes("add_item_to_cart")
    && !input.toolsUsed.includes("create_checkout_session")
    && input.blocks.some(hasCartItems)
    && !input.blocks.some(hasPreparedCheckout);
}

function hasCartItems(block: ConversationBlock): boolean {
  return block.type === "cart_summary" && block.data.items.length > 0;
}

function hasPreparedCheckout(block: ConversationBlock): boolean {
  return block.type === "checkout_prepared";
}

function isPreparedCheckout(value: unknown): value is PreparedCheckout {
  if (!isRecord(value)) return false;
  return value.checkoutPrepared === true
    && typeof value.actionId === "string"
    && typeof value.cartId === "string"
    && (value.shippingPreference === "fastest" || value.shippingPreference === "cheapest")
    && (value.paymentPreference === "pix" || value.paymentPreference === "card");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
