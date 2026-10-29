import type { CartItem, ChatTurn, CheckoutExperienceSnapshot, CheckoutSession } from "@zyon/shared-types";

export const ADD_ITEM_TO_CART_PORT = Symbol("ADD_ITEM_TO_CART_PORT");

/**
 * Abstraction over checkout session operations needed by the catalog module.
 * Checkout implements this port — catalog depends on the abstraction, not the concrete repos.
 * (CAT-H1: Introduce AddItemToCartPort)
 */
export interface AddItemToCartPort {
  getSession(merchantId: string, sessionId: string): Promise<CheckoutSession | undefined>;
  saveSession(session: CheckoutSession): Promise<void>;
  appendChatTurn(merchantId: string, sessionId: string, turn: ChatTurn): Promise<CheckoutSession>;
}
