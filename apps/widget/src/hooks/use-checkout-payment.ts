import { useState } from "react";
import type { WidgetConfig } from "../lib/widget-types.js";
import { checkoutJson, CHECKOUT_EMBED_PATHS, CHECKOUT_LEGACY_PATHS } from "../lib/embed-client.js";
import { paymentIntentSnapshotSchema } from "../lib/widget-schemas.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";
import type { CheckoutChatState } from "./use-checkout-chat.js";

import type { CryptoPaymentState } from "./crypto-payment.types.js";

export interface StripeIntent {
  intentId: string;
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
  const [cryptoPayment, setCryptoPayment] = useState<CryptoPaymentState | null>(null);

  type PaySnapshot = {
    id?: string;
    amountCents?: number;
    approvedAmountCents?: number;
    currency?: string;
    status?: string;
    buyerFacing?: {
      invoiceUrl?: string;
      qrCodeCopyPaste?: string;
      clientSecret?: string;
      stripePublishableKey?: string;
      chainId?: number;
      chain?: string;
      evmNetwork?: string;
      chainLabel?: string;
      tokenAddress?: string;
      tokenSymbol?: string;
      amountAtomic?: string;
      amountDisplay?: string;
      destinationAddress?: string;
      quoteExpiresAt?: string;
      walletConnectProjectId?: string;
    };
  };

  function markPaymentCompleted(amountCents?: number, currency = "BRL"): void {
    setStripeIntent(null);
    setCryptoPayment(null);
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

  async function createPaymentIntent(method: "pix" | "card" | "crypto"): Promise<void> {
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
        setCryptoPayment(null);
        setStripeIntent({
          intentId: snap.id ?? "",
          clientSecret: bf.clientSecret,
          publishableKey: bf.stripePublishableKey,
          amountCents: snap.amountCents ?? 0,
          currency: snap.currency ?? "BRL"
        });
        return;
      }

      if (
        method === "crypto" &&
        bf?.chainId &&
        bf?.tokenAddress &&
        bf?.amountAtomic &&
        bf?.destinationAddress &&
        bf?.quoteExpiresAt &&
        snap.id
      ) {
        setStripeIntent(null);
        setCryptoPayment({
          intentId: snap.id,
          amountCents: snap.amountCents,
          currency: snap.currency,
          quote: {
            chainId: bf.chainId,
            chain: bf.chain ?? "polygon",
            evmNetwork: bf.evmNetwork ?? "testnet",
            chainLabel: bf.chainLabel ?? "Polygon",
            tokenAddress: bf.tokenAddress,
            tokenSymbol: bf.tokenSymbol ?? "USDC",
            amountAtomic: bf.amountAtomic,
            amountDisplay: bf.amountDisplay ?? `${bf.amountAtomic} USDC`,
            destinationAddress: bf.destinationAddress,
            quoteExpiresAt: bf.quoteExpiresAt,
            walletConnectProjectId: bf.walletConnectProjectId
          }
        });
        appendAgentTurn(
          `Cotação crypto pronta: ${bf.amountDisplay ?? "USDC"} na rede ${bf.chainLabel ?? "EVM"}. Conecte sua carteira e confirme o envio.`,
          { stream: true }
        );
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

  function onStripePaymentConfirmed(amountCents: number, currency = "BRL"): Promise<void> {
    return confirmStripePayment(amountCents, currency);
  }

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
        markPaymentCompleted(amountCents, currency);
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

  async function confirmCryptoPayment(
    intentId: string,
    txHash: string,
    walletAddress: string
  ): Promise<void> {
    if (!session) return;
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const path = paths.cryptoPaymentConfirm(intentId);
    try {
      const result = await checkoutJson<{ status: string }>(apiOrigin, path, {
        ...embedOpts,
        body: {
          session_id: session.session_id,
          tx_hash: txHash,
          wallet_address: walletAddress,
          ...(config.mode !== "embed" && { merchant_id: config.merchantId })
        },
        schema: undefined
      });
      if (result.status === "approved") {
        markPaymentCompleted(cryptoPayment?.amountCents, cryptoPayment?.currency ?? "BRL");
      }
    } catch {
      appendAgentTurn(
        "Recebemos sua transação, mas a confirmação ainda não foi validada. Aguarde alguns segundos ou tente novamente.",
        { stream: true }
      );
      throw new Error("crypto_confirm_failed");
    }
  }

  return {
    createPaymentIntent,
    createEmbedPaymentIntentDemo,
    stripeIntent,
    cryptoPayment,
    setCryptoPayment,
    confirmCryptoPayment,
    onStripePaymentConfirmed,
    onStripePaymentError
  };
}

export type CheckoutPaymentState = ReturnType<typeof useCheckoutPayment>;
