import { useEffect, useRef, useState } from "react";
import type { WidgetConfig } from "../lib/widget-types.js";
import {
  checkoutErrorCode,
  checkoutErrorStatus,
  checkoutGet,
  checkoutJson,
  CHECKOUT_EMBED_PATHS,
  CHECKOUT_LEGACY_PATHS
} from "../lib/embed-client.js";
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

function paymentIntentErrorMessage(error: unknown, method: "pix" | "card" | "crypto"): string {
  const code = checkoutErrorCode(error);
  switch (code) {
    case "shipping_method_required_before_payment":
      return "Antes do pagamento, escolha uma opcao de entrega. Vou te mostrar as alternativas de frete para continuar.";
    case "checkout_session_not_found":
      return "Sua sessao expirou. Recarregue o checkout e tente novamente.";
    case "payment_intent_amount_invalid":
      return "O valor do pedido ficou invalido. Revise o carrinho antes de pagar.";
    case "asaas_customer_data_incomplete":
    case "asaas_customer_id_missing_on_buyer_session":
      return "Preciso concluir seus dados fiscais antes de gerar a cobranca: nome completo, e-mail e CPF.";
    case "stripe_provider_not_configured":
      return "Pagamento por cartao ainda nao esta habilitado nesta loja. Tente PIX agora ou avise o suporte para conectar o Stripe.";
    case "stripe_connect_not_configured":
      return "Pagamento por cartao ainda nao esta conectado para esta loja. Tente PIX ou fale com o suporte da loja.";
    case "stripe_connect_not_active":
      return "O cartao ainda esta em ativacao pelo provedor. Tente PIX por enquanto ou fale com o suporte.";
    case "asaas_provider_not_configured":
    case "payment_provider_not_configured":
    case "payment_provider_not_configured_for_customer_creation":
      return "A loja ainda nao configurou o provedor de cobranca. O suporte precisa ativar os pagamentos antes de concluir.";
    case "asaas_connection_not_active":
      return "A conta de pagamentos da loja ainda nao esta ativa. Fale com o suporte para finalizar a compra.";
    case "asaas_customer_create_failed":
    case "asaas_payment_create_failed":
    case "asaas_tokenize_failed":
    case "payment_provider_request_failed":
      return "O provedor de pagamento nao conseguiu criar a cobranca agora. Revise os dados e tente novamente em instantes.";
    default:
      break;
  }

  const status = checkoutErrorStatus(error);
  if (status && status >= 500) {
    return "O pagamento falhou por instabilidade do provedor/API. Tente novamente em instantes.";
  }

  return method === "card"
    ? "Nao foi possivel iniciar o pagamento por cartao. Verifique os dados ou tente PIX."
    : "Nao foi possivel gerar a cobranca. Verifique os dados de pagamento.";
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
  const [pixPolling, setPixPolling] = useState(false);
  const pollRef = useRef<{ active: boolean } | null>(null);

  function cancelPoll(): void {
    if (pollRef.current) pollRef.current.active = false;
    pollRef.current = null;
  }

  // Cancel any in-flight PIX poll when the widget unmounts.
  useEffect(() => () => cancelPoll(), []);

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  type PaymentStatusResponse = {
    status: string;
    amount_cents: number;
    approved_amount_cents?: number;
    currency: string;
    order_id?: string;
    provider_payment_id?: string;
    receipt_url?: string;
  };

  /**
   * Read the authoritative status once and complete the confirmation with the
   * real order id / receipt. Falls back to known amount/currency if the read
   * fails so the buyer still gets a confirmation after an approved charge.
   */
  async function finalizeConfirmation(
    intentId: string,
    fallbackAmountCents?: number,
    fallbackCurrency = "BRL"
  ): Promise<void> {
    if (!session) return;
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const query = config.mode === "embed"
      ? `?session_id=${encodeURIComponent(session.session_id)}`
      : `?session_id=${encodeURIComponent(session.session_id)}&merchant_id=${encodeURIComponent(config.merchantId)}`;
    try {
      const res = await checkoutGet<PaymentStatusResponse>(
        apiOrigin,
        `${paths.paymentStatus(intentId)}${query}`,
        { ...embedOpts }
      );
      markPaymentCompleted(res.approved_amount_cents ?? res.amount_cents ?? fallbackAmountCents, res.currency ?? fallbackCurrency, {
        orderId: res.order_id,
        receiptUrl: res.receipt_url
      });
    } catch {
      markPaymentCompleted(fallbackAmountCents, fallbackCurrency);
    }
  }

  /**
   * Poll the authoritative payment status until the provider webhook flips it
   * to approved, or the charge fails/expires, or the deadline passes. PIX is
   * never confirmed optimistically — only the persisted status drives completion.
   */
  async function pollPaymentStatus(
    intentId: string,
    opts?: { intervalMs?: number; timeoutMs?: number }
  ): Promise<void> {
    if (!session || !intentId) return;
    const intervalMs = opts?.intervalMs ?? 4000;
    const timeoutMs = opts?.timeoutMs ?? 1000 * 60 * 10;
    const deadline = Date.now() + timeoutMs;
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const base = paths.paymentStatus(intentId);
    const query = config.mode === "embed"
      ? `?session_id=${encodeURIComponent(session.session_id)}`
      : `?session_id=${encodeURIComponent(session.session_id)}&merchant_id=${encodeURIComponent(config.merchantId)}`;
    const path = `${base}${query}`;

    const controller = { active: true };
    pollRef.current = controller;
    setPixPolling(true);
    try {
      while (controller.active && Date.now() < deadline) {
        await delay(intervalMs);
        if (!controller.active) return;
        try {
          const res = await checkoutGet<PaymentStatusResponse>(apiOrigin, path, { ...embedOpts });
          if (res.status === "approved") {
            markPaymentCompleted(res.approved_amount_cents ?? res.amount_cents, res.currency, {
              orderId: res.order_id,
              receiptUrl: res.receipt_url
            });
            return;
          }
          if (res.status === "failed" || res.status === "expired" || res.status === "canceled") {
            appendAgentTurn(
              "O pagamento PIX expirou ou foi recusado. Gere uma nova cobranca para tentar novamente.",
              { stream: true }
            );
            return;
          }
        } catch {
          // Transient read error; keep polling until the deadline.
        }
      }
      if (controller.active) {
        appendAgentTurn(
          "Ainda nao recebi a confirmacao do seu PIX. Assim que o pagamento for compensado, libero seu pedido aqui.",
          { stream: true }
        );
      }
    } finally {
      controller.active = false;
      if (pollRef.current === controller) pollRef.current = null;
      setPixPolling(false);
    }
  }

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

  function markPaymentCompleted(
    amountCents?: number,
    currency = "BRL",
    opts?: { orderId?: string; receiptUrl?: string }
  ): void {
    cancelPoll();
    setStripeIntent(null);
    setCryptoPayment(null);
    const total = typeof amountCents === "number"
      ? `${(amountCents / 100).toFixed(2)} ${currency}`.trim()
      : "";
    // Confirmation is built from real, authoritative references: the order id and
    // the provider receipt URL persisted server-side (never optimistic/synthetic).
    const orderLine = opts?.orderId ? ` Pedido ${opts.orderId}.` : "";
    const receiptLine = opts?.receiptUrl ? ` Recibo: ${opts.receiptUrl}.` : "";
    appendAgentTurn(
      (total
        ? `Pagamento confirmado (${total}). Pedido aprovado!`
        : "Pagamento confirmado! Pedido aprovado.") +
        `${orderLine}${receiptLine} Separei o resumo e o link de retorno logo abaixo.`,
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
        if (snap.id) {
          await finalizeConfirmation(snap.id, snap.approvedAmountCents ?? snap.amountCents, snap.currency ?? "BRL");
        } else {
          markPaymentCompleted(snap.approvedAmountCents ?? snap.amountCents, snap.currency ?? "BRL");
        }
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

      // Async charge (PIX/boleto): poll authoritative status; confirmation is webhook-driven.
      cancelPoll();
      if (snap.id) {
        void pollPaymentStatus(snap.id);
      }
    } catch (error) {
      appendAgentTurn(
        paymentIntentErrorMessage(error, method),
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
        await finalizeConfirmation(stripeIntent.intentId, amountCents, currency);
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
        if (snap.id) {
          await finalizeConfirmation(snap.id, snap.approvedAmountCents ?? snap.amountCents, snap.currency ?? "BRL");
        } else {
          markPaymentCompleted(snap.approvedAmountCents ?? snap.amountCents, snap.currency ?? "BRL");
        }
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
    } catch (error) {
      appendAgentTurn(
        paymentIntentErrorMessage(error, "pix"),
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
        await finalizeConfirmation(intentId, cryptoPayment?.amountCents, cryptoPayment?.currency ?? "BRL");
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
    pollPaymentStatus,
    pixPolling,
    stripeIntent,
    cryptoPayment,
    setCryptoPayment,
    confirmCryptoPayment,
    onStripePaymentConfirmed,
    onStripePaymentError
  };
}

export type CheckoutPaymentState = ReturnType<typeof useCheckoutPayment>;
