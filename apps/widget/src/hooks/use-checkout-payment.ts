import { useEffect, useRef } from "react";
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

import { usePixPayment, PIX_WAIT_WINDOW_MS } from "./use-pix-payment.js";
import { useStripePayment } from "./use-stripe-payment.js";
import { useCryptoPayment } from "./use-crypto-payment.js";

// Re-export sub-hook types so consumers importing from this module keep working.
export type { StripeIntent } from "./use-stripe-payment.js";
export type { PixWaitingStatus, PixWaitingState } from "./use-pix-payment.js";

/**
 * Derives a stable idempotency key per payment attempt from immutable inputs
 * (session, method, offer) rather than generating a new UUID on every call.
 * This prevents duplicate charges when the user taps the payment button twice.
 *
 * The key is stable for the lifetime of a session+method+offer combination, so
 * a re-submission sends the same key and the backend treats it as idempotent.
 */
function stableIdempotencyKey(sessionId: string, method: string, offerId?: string): string {
  return `${sessionId}::${method}::${offerId ?? "none"}`;
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

type PaymentStatusResponse = {
  status: string;
  amount_cents: number;
  approved_amount_cents?: number;
  currency: string;
  order_id?: string;
  provider_payment_id?: string;
  receipt_url?: string;
};

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

export function useCheckoutPayment(
  config: WidgetConfig,
  sessionState: CheckoutSessionState,
  chatState: Pick<CheckoutChatState, "appendAgentTurn" | "lastChat">
) {
  const { session, apiOrigin, embedOpts } = sessionState;
  const { appendAgentTurn, lastChat } = chatState;

  // P1: in-flight lock prevents duplicate intent creation from rapid re-taps.
  const intentInFlightRef = useRef(false);
  // P3: ref always reflects the latest activeExperience so the long-running
  // PIX poll closure never spreads a stale snapshot into syncExperience.
  const activeExperienceRef = useRef(sessionState.activeExperience);
  useEffect(() => {
    activeExperienceRef.current = sessionState.activeExperience;
  }, [sessionState.activeExperience]);

  // --- shared completion callback ----------------------------------------

  function markPaymentCompleted(
    amountCents?: number,
    currency = "BRL",
    opts?: { orderId?: string; receiptUrl?: string }
  ): void {
    pix.cancelPoll();
    stripe.clearStripeIntent();
    crypto.clearCryptoPayment();
    pix.setPixWaiting((prev) => (prev ? { ...prev, status: "approved" } : prev));
    const total = typeof amountCents === "number"
      ? `${(amountCents / 100).toFixed(2)} ${currency}`.trim()
      : "";
    const orderLine = opts?.orderId ? ` Pedido ${opts.orderId}.` : "";
    const receiptLine = opts?.receiptUrl ? ` Recibo: ${opts.receiptUrl}.` : "";
    appendAgentTurn(
      (total
        ? `Pagamento confirmado (${total}). Pedido aprovado!`
        : "Pagamento confirmado! Pedido aprovado.") +
        `${orderLine}${receiptLine} Separei o resumo e o link de retorno logo abaixo.`,
      { stream: true }
    );
    // P3: read the freshest activeExperience from the ref rather than the
    // closure snapshot, avoiding overwrites of updates made during a long poll.
    const freshExperience = activeExperienceRef.current;
    sessionState.syncExperience({
      ...freshExperience,
      stage: "completed",
      copy: {
        ...freshExperience.copy,
        quick_replies: [],
        focus_input: false
      }
    });
  }

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

  // --- sub-hooks ---------------------------------------------------------

  const pix = usePixPayment({
    config,
    sessionState,
    chatState,
    onApproved: (amountCents, currency, opts) =>
      markPaymentCompleted(amountCents, currency, opts),
  });

  const stripe = useStripePayment({
    config,
    sessionState,
    chatState,
    onApproved: (_intentId, amountCents, currency) =>
      finalizeConfirmation(_intentId, amountCents, currency),
  });

  const crypto = useCryptoPayment({
    config,
    sessionState,
    chatState,
    onApproved: (intentId, amountCents, currency) =>
      finalizeConfirmation(intentId, amountCents, currency),
  });

  // --- intent creation ---------------------------------------------------

  async function createPaymentIntent(method: "pix" | "card" | "crypto"): Promise<void> {
    if (!session) return;
    // P1: ignore re-entrant calls while a request is in flight.
    if (intentInFlightRef.current) return;
    intentInFlightRef.current = true;
    const offerNow = lastChat?.authorized_offer;
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const body: Record<string, unknown> = {
      session_id: session.session_id,
      idempotency_key: stableIdempotencyKey(session.session_id, method, offerNow?.id),
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
        if (!snap.id) {
          appendAgentTurn(
            "Não foi possível iniciar o pagamento por cartão: referência do intent ausente. Tente novamente ou use PIX.",
            { stream: true }
          );
          return;
        }
        crypto.clearCryptoPayment();
        stripe.setStripeIntent({
          intentId: snap.id,
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
        stripe.clearStripeIntent();
        crypto.setCryptoPayment({
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
      pix.cancelPoll();
      if (snap.id) {
        if (method === "pix") {
          pix.surfacePixWaiting({
            copyPaste: bf?.qrCodeCopyPaste,
            invoiceUrl: bf?.invoiceUrl,
            amountCents: snap.amountCents,
            currency: snap.currency,
          });
        }
        void pix.pollPaymentStatus(snap.id);
      }
    } catch (error) {
      appendAgentTurn(
        paymentIntentErrorMessage(error, method),
        { stream: true }
      );
    } finally {
      intentInFlightRef.current = false;
    }
  }

  async function createEmbedPaymentIntentDemo(): Promise<void> {
    if (!session || config.mode !== "embed") return;

    const offerNow = lastChat?.authorized_offer;
    const body = {
      session_id: session.session_id,
      idempotency_key: stableIdempotencyKey(session.session_id, "pix", offerNow?.id),
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

  // --- public API (unchanged from original) ------------------------------

  return {
    createPaymentIntent,
    createEmbedPaymentIntentDemo,
    pollPaymentStatus: pix.pollPaymentStatus,
    pixPolling: pix.pixPolling,
    pixWaiting: pix.pixWaiting,
    dismissPixWaiting: pix.dismissPixWaiting,
    stripeIntent: stripe.stripeIntent,
    cryptoPayment: crypto.cryptoPayment,
    setCryptoPayment: crypto.setCryptoPayment,
    confirmCryptoPayment: crypto.confirmCryptoPayment,
    onStripePaymentConfirmed: stripe.onStripePaymentConfirmed,
    onStripePaymentError: stripe.onStripePaymentError
  };
}

export type CheckoutPaymentState = ReturnType<typeof useCheckoutPayment>;
