import type { CheckoutSession } from "@zyon/shared-types";
import { moneyCents } from "@zyon/rules-engine";
import { deriveChatStage } from "./customer-extraction.service.js";

// Versioned with the reviewed baseline: cart.total is BRL, not integer cents.
export const CHECKOUT_CHAT_BINDINGS_VERSION = "checkout-chat-bindings-v2" as const;

/** Presentation only. Does not recalculate prices or authorize an incentive. */
export function checkoutCartPrompt(cart?: { total?: unknown; currency?: unknown }): string | undefined {
  if (cart?.currency !== "BRL") return undefined;
  const cents = moneyCents(cart.total);
  if (cents === null) return undefined;
  // Integer formatting avoids floating-point rounding at the upper safe bound.
  return `Carrinho: R$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Existing advisory signal, not proof of a payment provider's outcome. */
export function checkoutPaymentFailureSignal(session: Pick<CheckoutSession, "chatHistory">): boolean {
  const lastAgentTurn = [...session.chatHistory].reverse().find(t => t.role === "agent")?.text;
  return /pagamento (falhou|recusad|não foi|nao foi|nao aprovad|não aprovad)/i.test(lastAgentTurn ?? "");
}

/** Call under the session lock for experimental turns. Never copies customer,
 * history, item names, instructions or buyer memory into the system prompt. */
export function checkoutSessionPrompt(session: CheckoutSession) {
  const cartInfo = checkoutCartPrompt(session.cart);
  if (cartInfo === undefined) throw new Error("CHECKOUT_CHAT_CART_CONTEXT_INVALID");
  return { cartInfo, stage: deriveChatStage(session), paymentJustFailed: checkoutPaymentFailureSignal(session) };
}
