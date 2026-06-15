import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { formatCurrency } from "../../hooks/checkout-presentation.js";
import type { CryptoPaymentPanelModel } from "../models/crypto-payment-panel.model.js";

export function selectCryptoPaymentPanelModel(
  vm: CheckoutAgentViewModel,
): CryptoPaymentPanelModel | null {
  const payment = vm.cryptoPayment;
  const quote = payment?.quote;
  if (!payment || !quote) return null;

  const orderTotalLabel =
    typeof payment.amountCents === "number"
      ? formatCurrency(payment.amountCents / 100, payment.currency ?? "BRL")
      : null;

  return {
    intentId: payment.intentId,
    orderTotalLabel,
    quote,
    expired: Date.parse(quote.quoteExpiresAt) <= Date.now(),
    onConfirmPayment: vm.confirmCryptoPayment,
    onClose: () => vm.setShowCryptoPanel(false),
  };
}
