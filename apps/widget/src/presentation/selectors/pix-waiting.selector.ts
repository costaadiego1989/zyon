import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { formatCurrency } from "../../hooks/checkout-presentation.js";
import type { PixWaitingModel } from "../models/pix-waiting.model.js";

/**
 * Build the PIX waiting model from the authoritative polling state. Returns
 * null when no PIX charge is in flight (the component is mounted on the shared
 * shell but only paints once a charge exists), so it is channel-agnostic.
 */
export function selectPixWaitingModel(vm: CheckoutAgentViewModel): PixWaitingModel | null {
  const waiting = vm.pixWaiting;
  if (!waiting) return null;

  return {
    status: waiting.status,
    copyPaste: waiting.copyPaste,
    invoiceUrl: waiting.invoiceUrl,
    amountLabel:
      typeof waiting.amountCents === "number"
        ? formatCurrency(waiting.amountCents / 100, waiting.currency)
        : null,
    deadline: waiting.deadline,
    onDismiss: vm.dismissPixWaiting,
  };
}
