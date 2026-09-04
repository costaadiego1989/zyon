import { useState } from "react";
import type { WidgetConfig } from "../lib/widget-types.js";
import { checkoutJson, CHECKOUT_EMBED_PATHS, CHECKOUT_LEGACY_PATHS } from "../lib/embed-client.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";
import type { CheckoutChatState } from "./use-checkout-chat.js";

export interface StripeIntent {
  intentId: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
}

export type StripePaymentDeps = {
  config: WidgetConfig;
  sessionState: CheckoutSessionState;
  chatState: Pick<CheckoutChatState, "appendAgentTurn" | "lastChat">;
  onApproved: (
    intentId: string,
    amountCents: number,
    currency: string,
    opts?: { orderId?: string; receiptUrl?: string }
  ) => Promise<void>;
};

/**
 * Stripe-specific concerns: holds the local StripeIntent snapshot used by the
 * card form, drives the post-3DS confirmation call, and surfaces Stripe-side
 * errors back into the agent turn stream. Confirmation is intentionally
 * webhook-driven — we never mark the order approved optimistically.
 */
export function useStripePayment(deps: StripePaymentDeps) {
  const { config, sessionState, chatState, onApproved } = deps;
  const { session, apiOrigin, embedOpts } = sessionState;
  const { appendAgentTurn } = chatState;
  const [stripeIntent, setStripeIntent] = useState<StripeIntent | null>(null);

  async function confirmStripePayment(amountCents: number, currency = "BRL"): Promise<void> {
    if (!session || !stripeIntent?.intentId) {
      appendAgentTurn(
        "Recebi seu pagamento e estou aguardando a confirmacao do provedor. Assim que ela chegar, libero seu pedido aqui.",
        { stream: true }
      );
      return;
    }

    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const path = paths.stripePaymentConfirm(stripeIntent.intentId);
    try {
      const result = await checkoutJson<{ status: string }>(apiOrigin, path, {
        ...embedOpts,
        body: {
          session_id: session.session_id,
          ...(config.mode !== "embed" ? { merchant_id: config.merchantId } : {})
        }
      });
      if (result.status === "approved") {
        await onApproved(stripeIntent.intentId, amountCents, currency);
        return;
      }
      appendAgentTurn(
        "Pagamento recebido. Estou aguardando a confirmacao final do provedor.",
        { stream: true }
      );
    } catch {
      const total = typeof amountCents === "number"
        ? `${(amountCents / 100).toFixed(2)} ${currency}`.trim()
        : "";
      appendAgentTurn(
        total
          ? `Recebi seu pagamento (${total}) e estou aguardando a confirmacao do provedor. Assim que ela chegar, libero seu pedido aqui.`
          : "Recebi seu pagamento e estou aguardando a confirmacao do provedor. Assim que ela chegar, libero seu pedido aqui.",
        { stream: true }
      );
    }
  }

  function onStripePaymentConfirmed(amountCents: number, currency = "BRL"): Promise<void> {
    return confirmStripePayment(amountCents, currency);
  }

  function onStripePaymentError(message: string): void {
    appendAgentTurn(message || "Pagamento recusado. Verifique os dados do cartao.", { stream: true });
  }

  function clearStripeIntent(): void {
    setStripeIntent(null);
  }

  return {
    stripeIntent,
    setStripeIntent,
    clearStripeIntent,
    confirmStripePayment,
    onStripePaymentConfirmed,
    onStripePaymentError,
  };
}