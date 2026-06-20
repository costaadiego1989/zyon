import type { PixWaitingStatus } from "../../hooks/use-checkout-payment.js";

/**
 * View model for the persistent PIX "aguardando/escutando pagamento" component
 * (ADR §9.2). It renders identically on the shared shell in both channels and
 * exposes the e2e contract `.aacp-pix-waiting[data-pix-state]`.
 */
export type PixWaitingModel = {
  status: PixWaitingStatus;
  /** PIX copy-paste (BR Code) string when the provider returned one. */
  copyPaste: string | null;
  /** Hosted invoice/fallback link when no copy-paste code is available. */
  invoiceUrl: string | null;
  /** Formatted order amount, e.g. "R$ 89,98". */
  amountLabel: string | null;
  /** Hard deadline (epoch ms) for the 10-minute listening window. */
  deadline: number;
  /** Dismiss the component (used on terminal states). */
  onDismiss: () => void;
};
