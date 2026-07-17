import { useState } from "react";
import type { WidgetConfig } from "../lib/widget-types.js";
import { checkoutJson, CHECKOUT_EMBED_PATHS, CHECKOUT_LEGACY_PATHS } from "../lib/embed-client.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";
import type { CheckoutChatState } from "./use-checkout-chat.js";
import type { CryptoPaymentState } from "./crypto-payment.types.js";

export type CryptoPaymentDeps = {
  config: WidgetConfig;
  sessionState: CheckoutSessionState;
  chatState: Pick<CheckoutChatState, "appendAgentTurn" | "lastChat">;
  onApproved: (
    intentId: string,
    amountCents?: number,
    currency?: string,
    opts?: { orderId?: string; receiptUrl?: string }
  ) => Promise<void>;
};

/**
 * Crypto (EVM) concerns: holds the on-chain quote snapshot used by the wallet
 * panel and drives the post-broadcast confirmation call. Approval is webhook-
 * driven server-side; we surface a transient agent turn on retry-needed paths.
 */
export function useCryptoPayment(deps: CryptoPaymentDeps) {
  const { config, sessionState, chatState, onApproved } = deps;
  const { session, apiOrigin, embedOpts } = sessionState;
  const { appendAgentTurn } = chatState;
  const [cryptoPayment, setCryptoPayment] = useState<CryptoPaymentState | null>(null);

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
        await onApproved(intentId, cryptoPayment?.amountCents, cryptoPayment?.currency ?? "BRL");
      }
    } catch {
      appendAgentTurn(
        "Recebemos sua transação, mas a confirmação ainda não foi validada. Aguarde alguns segundos ou tente novamente.",
        { stream: true }
      );
      throw new Error("crypto_confirm_failed");
    }
  }

  function clearCryptoPayment(): void {
    setCryptoPayment(null);
  }

  return {
    cryptoPayment,
    setCryptoPayment,
    clearCryptoPayment,
    confirmCryptoPayment,
  };
}
