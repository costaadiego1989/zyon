import type { WidgetConfig } from "../lib/widget-types.js";
import { checkoutJson, CHECKOUT_EMBED_PATHS, CHECKOUT_LEGACY_PATHS } from "../lib/embed-client.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";
import type { CheckoutChatState } from "./use-checkout-chat.js";

export interface CardDetails {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export function useCheckoutPayment(
  config: WidgetConfig,
  sessionState: CheckoutSessionState,
  chatState: Pick<CheckoutChatState, "appendAgentTurn" | "lastChat">
) {
  const { session, apiOrigin, embedOpts } = sessionState;
  const { appendAgentTurn, lastChat } = chatState;

  async function createPaymentIntent(method: "pix" | "card", card?: CardDetails): Promise<void> {
    if (!session) return;
    type PaySnapshot = {
      amountCents?: number;
      currency?: string;
      buyerFacing?: { invoiceUrl?: string; qrCodeCopyPaste?: string };
    };
    const offerNow = lastChat?.authorized_offer;
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const body: Record<string, unknown> = {
      session_id: session.session_id,
      idempotency_key: crypto.randomUUID(),
      method,
      ...(config.mode !== "embed" && { merchant_id: config.merchantId }),
      ...(offerNow?.approved && offerNow.id ? { accepted_offer_id: offerNow.id } : {}),
      ...(card ? { card } : {})
    };
    try {
      const snap = await checkoutJson<PaySnapshot>(apiOrigin, paths.paymentIntents, { ...embedOpts, body });
      const total = typeof snap.amountCents === "number"
        ? `${(snap.amountCents / 100).toFixed(2)} ${snap.currency ?? ""}`.trim()
        : "";
      const bf = snap.buyerFacing;
      const pixLine = bf?.invoiceUrl
        ? ` Fatura/link: ${bf.invoiceUrl}.`
        : bf?.qrCodeCopyPaste
          ? ` Copia e cola PIX: ${bf.qrCodeCopyPaste.slice(0, 80)}${bf.qrCodeCopyPaste.length > 80 ? "..." : ""}.`
          : "";
      appendAgentTurn(total ? `Cobrança gerada (${total}).${pixLine}` : `Cobrança criada.${pixLine}`, { stream: true });
    } catch {
      appendAgentTurn(
        "Não foi possível gerar a cobrança. Verifique os dados de pagamento.",
        { stream: true }
      );
    }
  }

  async function createEmbedPaymentIntentDemo(): Promise<void> {
    if (!session || config.mode !== "embed") return;
    type EmbedPaySnapshot = {
      amountCents?: number;
      currency?: string;
      buyerFacing?: { invoiceUrl?: string; qrCodeCopyPaste?: string };
    };

    const offerNow = lastChat?.authorized_offer;
    const body = {
      session_id: session.session_id,
      idempotency_key: crypto.randomUUID(),
      method: "pix" as const,
      ...(offerNow?.approved && offerNow.id ? { accepted_offer_id: offerNow.id } : {})
    };

    try {
      const snap = await checkoutJson<EmbedPaySnapshot>(
        apiOrigin,
        CHECKOUT_EMBED_PATHS.paymentIntents,
        { ...embedOpts, body }
      );
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
      appendAgentTurn(total ? `Cobrança gerada (${total}).${pixLine}` : `Cobrança criada.${pixLine}`, { stream: true });
    } catch {
      appendAgentTurn(
        "Não foi possível gerar a cobrança. Verifique o token embed e os dados do pagador na API.",
        { stream: true }
      );
    }
  }

  return { createPaymentIntent, createEmbedPaymentIntentDemo };
}

export type CheckoutPaymentState = ReturnType<typeof useCheckoutPayment>;
