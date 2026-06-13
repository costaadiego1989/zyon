import { useState } from "react";
import type { WidgetConfig } from "../lib/widget-types.js";
import { checkoutJson, CHECKOUT_EMBED_PATHS, CHECKOUT_LEGACY_PATHS } from "../lib/embed-client.js";
import { paymentIntentSnapshotSchema } from "../lib/widget-schemas.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";
import type { CheckoutChatState } from "./use-checkout-chat.js";

export interface StripeIntent {
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
}

export function useCheckoutPayment(
  config: WidgetConfig,
  sessionState: CheckoutSessionState,
  chatState: Pick<CheckoutChatState, "appendAgentTurn" | "lastChat">
) {
  const { session, apiOrigin, embedOpts } = sessionState;
  const { appendAgentTurn, lastChat } = chatState;
  const [stripeIntent, setStripeIntent] = useState<StripeIntent | null>(null);

  type PaySnapshot = {
    amountCents?: number;
    approvedAmountCents?: number;
    currency?: string;
    status?: string;
    buyerFacing?: {
      invoiceUrl?: string;
      qrCodeCopyPaste?: string;
      clientSecret?: string;
      stripePublishableKey?: string;
    };
  };

  function markPaymentCompleted(amountCents?: number, currency = "BRL"): void {
    setStripeIntent(null);
    const total = typeof amountCents === "number"
      ? `${(amountCents / 100).toFixed(2)} ${currency}`.trim()
      : "";
    appendAgentTurn(
      total
        ? `Pagamento confirmado (${total}). Pedido aprovado! Separei o resumo e o link de retorno logo abaixo.`
        : "Pagamento confirmado! Pedido aprovado. Separei o resumo e o link de retorno logo abaixo.",
      { stream: true }
    );
    sessionState.syncExperience({
      ...sessionState.activeExperience,
      stage: "completed",
      copy: {
        ...sessionState.activeExperience.copy,
        quick_replies: [],
        focus_input: false
      }
    });
  }

  async function createPaymentIntent(method: "pix" | "card"): Promise<void> {
    if (!session) return;
    const offerNow = lastChat?.authorized_offer;
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const body: Record<string, unknown> = {
      session_id: session.session_id,
      idempotency_key: crypto.randomUUID(),
      method,
      ...(config.mode !== "embed" && { merchant_id: config.merchantId }),
      ...(offerNow?.approved && offerNow.id ? { accepted_offer_id: offerNow.id } : {})
    };
    try {
      const snap = await checkoutJson<PaySnapshot>(apiOrigin, paths.paymentIntents, {
        ...embedOpts,
        body,
        schema: paymentIntentSnapshotSchema
      });
      const bf = snap.buyerFacing;

      if (snap.status === "approved") {
        markPaymentCompleted(snap.approvedAmountCents ?? snap.amountCents, snap.currency ?? "BRL");
        return;
      }

      if (method === "card" && bf?.clientSecret && bf?.stripePublishableKey) {
        setStripeIntent({
          clientSecret: bf.clientSecret,
          publishableKey: bf.stripePublishableKey,
          amountCents: snap.amountCents ?? 0,
          currency: snap.currency ?? "BRL"
        });
        return;
      }

      const total = typeof snap.amountCents === "number"
        ? `${(snap.amountCents / 100).toFixed(2)} ${snap.currency ?? ""}`.trim()
        : "";
      const pixLine = bf?.invoiceUrl
        ? ` Fatura/link: ${bf.invoiceUrl}.`
        : bf?.qrCodeCopyPaste
          ? ` Copia e cola PIX: ${bf.qrCodeCopyPaste.slice(0, 80)}${bf.qrCodeCopyPaste.length > 80 ? "..." : ""}.`
          : "";
      appendAgentTurn(total ? `Cobranca gerada (${total}).${pixLine}` : `Cobranca criada.${pixLine}`, { stream: true });
    } catch {
      appendAgentTurn(
        "Nao foi possivel gerar a cobranca. Verifique os dados de pagamento.",
        { stream: true }
      );
    }
  }

  function onStripePaymentConfirmed(amountCents: number, currency: string): void {
    markPaymentCompleted(amountCents, currency);
  }

  function onStripePaymentError(message: string): void {
    appendAgentTurn(message || "Pagamento recusado. Verifique os dados do cartao.", { stream: true });
  }

  async function createEmbedPaymentIntentDemo(): Promise<void> {
    if (!session || config.mode !== "embed") return;

    const offerNow = lastChat?.authorized_offer;
    const body = {
      session_id: session.session_id,
      idempotency_key: crypto.randomUUID(),
      method: "pix" as const,
      ...(offerNow?.approved && offerNow.id ? { accepted_offer_id: offerNow.id } : {})
    };

    try {
      const snap = await checkoutJson<PaySnapshot>(
        apiOrigin,
        CHECKOUT_EMBED_PATHS.paymentIntents,
        { ...embedOpts, body, schema: paymentIntentSnapshotSchema }
      );

      if (snap.status === "approved") {
        markPaymentCompleted(snap.approvedAmountCents ?? snap.amountCents, snap.currency ?? "BRL");
        return;
      }

      const total =
        typeof snap.amountCents === "number"
          ? `${(snap.amountCents / 100).toFixed(2)} ${snap.currency ?? ""}`.trim()
          : "";
      const bf = snap.buyerFacing;
      const pixLine =
        bf?.invoiceUrl
          ? ` Fatura/link: ${bf.invoiceUrl}.`
          : bf?.qrCodeCopyPaste
            ? ` Copia e cola PIX: ${bf.qrCodeCopyPaste.slice(0, 80)}${bf.qrCodeCopyPaste.length > 80 ? "..." : ""}.`
            : "";
      appendAgentTurn(total ? `Cobranca gerada (${total}).${pixLine}` : `Cobranca criada.${pixLine}`, { stream: true });
    } catch {
      appendAgentTurn(
        "Nao foi possivel gerar a cobranca. Verifique o token embed e os dados do pagador na API.",
        { stream: true }
      );
    }
  }

  return {
    createPaymentIntent,
    createEmbedPaymentIntentDemo,
    stripeIntent,
    onStripePaymentConfirmed,
    onStripePaymentError
  };
}

export type CheckoutPaymentState = ReturnType<typeof useCheckoutPayment>;
