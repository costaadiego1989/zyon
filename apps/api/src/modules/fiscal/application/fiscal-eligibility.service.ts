import type { PersistedPaymentApproval } from "../../checkout/domain/ports/payment-approval.port.js";
import { assertPaymentAmount, orderTotalCents } from "../../payment/domain/payment-amount.js";
import type { FiscalState } from "../domain/fiscal-provider.js";

export interface FiscalEligibilityInput {
  sale: { orderId: string; orderMerchantId: string; sessionId: string; completedAt: Date | null; currency: string; totalCents: number;
    cancelledAt: Date | null; transmittedAt: Date | null };
  connection: { isActive: boolean; activatedAt: Date | null; disconnectedAt: Date | null } | null;
  /** Read from the payment port/persistence, never deserialized from a public completion body. */
  approval: PersistedPaymentApproval | null;
  inventorySyncMode?: string;
}
export interface FiscalEligibilityResult { eligible: boolean; state: FiscalState; code: string | null; paymentProofRef: string | null }
export class FiscalEligibilityService {
  evaluate({ sale, connection, approval }: FiscalEligibilityInput): FiscalEligibilityResult {
    const pending = (state: FiscalState, code: string): FiscalEligibilityResult => ({ eligible: false, state, code, paymentProofRef: null });
    if (!sale.completedAt || !Number.isFinite(sale.completedAt.getTime())) return pending("action_required", "fiscal_sale_not_completed");
    if (!connection?.isActive || !connection.activatedAt || connection.disconnectedAt) return pending("action_required", "fiscal_connection_inactive");
    if (sale.completedAt < connection.activatedAt) return pending("not_eligible_before_activation", "not_eligible_before_activation");
    if (sale.cancelledAt) return pending(sale.transmittedAt ? "action_required" : "suppressed",
      sale.transmittedAt ? "fiscal_cancellation_review_required" : "fiscal_sale_cancelled");
    if (!approval?.id || approval.status !== "approved" || approval.merchantId !== sale.orderMerchantId
      || approval.sessionId !== sale.sessionId || approval.providerPaymentId !== sale.orderId || approval.currency !== sale.currency
      || !Number.isSafeInteger(approval.amountCents) || approval.amountCents <= 0 || approval.approvedAmountCents !== approval.amountCents
      || orderTotalCents(approval.amountBreakdown ?? undefined, approval.amountCents) !== sale.totalCents) {
      return pending("awaiting_payment", "fiscal_payment_approval_required");
    }
    try { if (approval.amountBreakdown) assertPaymentAmount(approval.amountBreakdown, approval.amountCents, approval.currency); }
    catch { return pending("awaiting_payment", "fiscal_payment_approval_required"); }
    return { eligible: true, state: "queued", code: null, paymentProofRef: approval.id };
  }
}
