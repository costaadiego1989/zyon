import { useEffect, useRef, useState } from "react";
import type { WidgetConfig } from "../lib/widget-types.js";
import { checkoutGet, CHECKOUT_EMBED_PATHS, CHECKOUT_LEGACY_PATHS } from "../lib/embed-client.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";
import type { CheckoutChatState } from "./use-checkout-chat.js";

/**
 * Persistent "aguardando/escutando pagamento" state for PIX (ADR §9.2).
 *
 * Born `listening` the moment the charge is created in `requires_action`, it
 * carries the buyer-facing copy-paste / invoice references, the order amount and
 * a hard 10-minute `deadline` (epoch ms) for the countdown. The webhook-driven
 * poll flips it to `approved | failed | expired`. The widget never confirms PIX
 * optimistically — only the persisted status moves this machine forward.
 */
export type PixWaitingStatus = "listening" | "approved" | "failed" | "expired";

export interface PixWaitingState {
  status: PixWaitingStatus;
  copyPaste: string | null;
  invoiceUrl: string | null;
  amountCents?: number;
  currency: string;
  deadline: number;
}

export const PIX_WAIT_WINDOW_MS = 1000 * 60 * 10;

type PaymentStatusResponse = {
  status: string;
  amount_cents: number;
  approved_amount_cents?: number;
  currency: string;
  order_id?: string;
  provider_payment_id?: string;
  receipt_url?: string;
};

export type PixPaymentDeps = {
  config: WidgetConfig;
  sessionState: CheckoutSessionState;
  chatState: Pick<CheckoutChatState, "appendAgentTurn" | "lastChat">;
  onApproved: (
    amountCents: number | undefined,
    currency: string,
    opts?: { orderId?: string; receiptUrl?: string }
  ) => void;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PIX-specific concerns: persistent "waiting" UI surface (ADR §9.2) and the
 * long-running poll that flips it to approved/failed/expired. Lives in its own
 * hook so the checkout-payment composer can stay focused on intent creation
 * and the final confirmation flow.
 */
export function usePixPayment(deps: PixPaymentDeps) {
  const { config, sessionState, chatState, onApproved } = deps;
  const { session, apiOrigin, embedOpts } = sessionState;
  const { appendAgentTurn } = chatState;

  const [pixPolling, setPixPolling] = useState(false);
  const [pixWaiting, setPixWaiting] = useState<PixWaitingState | null>(null);
  const pollRef = useRef<{ active: boolean } | null>(null);

  function cancelPoll(): void {
    if (pollRef.current) pollRef.current.active = false;
    pollRef.current = null;
  }

  // Cancel any in-flight PIX poll when the widget unmounts.
  useEffect(() => () => cancelPoll(), []);

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
    const query =
      config.mode === "embed"
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
            setPixWaiting((prev) => (prev ? { ...prev, status: "approved" } : prev));
            onApproved(
              res.approved_amount_cents ?? res.amount_cents,
              res.currency,
              { orderId: res.order_id, receiptUrl: res.receipt_url }
            );
            return;
          }
          if (res.status === "failed" || res.status === "expired" || res.status === "canceled") {
            setPixWaiting((prev) =>
              prev ? { ...prev, status: res.status === "expired" ? "expired" : "failed" } : prev
            );
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
        setPixWaiting((prev) => (prev ? { ...prev, status: "expired" } : prev));
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

  function surfacePixWaiting(args: {
    copyPaste?: string | null;
    invoiceUrl?: string | null;
    amountCents?: number;
    currency?: string;
  }): void {
    setPixWaiting({
      status: "listening",
      copyPaste: args.copyPaste ?? null,
      invoiceUrl: args.invoiceUrl ?? null,
      amountCents: args.amountCents,
      currency: args.currency ?? "BRL",
      deadline: Date.now() + PIX_WAIT_WINDOW_MS,
    });
  }

  return {
    pixPolling,
    pixWaiting,
    dismissPixWaiting: () => setPixWaiting(null),
    setPixWaiting,
    pollPaymentStatus,
    cancelPoll,
    surfacePixWaiting,
  };
}
