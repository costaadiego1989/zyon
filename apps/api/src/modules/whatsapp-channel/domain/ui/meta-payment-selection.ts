import type { StoreUiAction, WhatsAppConversationState } from "./meta-ui.types.js";

/** An authenticated archived button selects a method for the SAME checkout.
 * Keep its original money fingerprint; the checkout revalidates it after any
 * confirmed provider cancellation. Other archived mutations remain rejected. */
export function recoverMetaPaymentChoice(previous: {
  action: StoreUiAction; checkoutSessionId?: string; conversationId?: string; selectionSent?: boolean;
}, state: WhatsAppConversationState): StoreUiAction | undefined {
  const action = previous.action;
  if (!previous.selectionSent || !state.checkoutSessionId || previous.checkoutSessionId !== state.checkoutSessionId || previous.conversationId !== state.conversationId ||
      action.kind !== "tool" || action.tool !== "create_payment" || !["pix", "card"].includes(String(action.args.method)) ||
      typeof action.args.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(action.args.fingerprint)) return undefined;
  return { kind: "tool", tool: "create_payment", args: {
    method: action.args.method, fingerprint: action.args.fingerprint, checkoutSessionId: state.checkoutSessionId,
  } };
}
