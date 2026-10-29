import type { MarketplaceRefundAllocation } from "./marketplace-refund-allocation.js";
import type { AsaasMarketplaceResidualAllocation } from "./asaas-marketplace-residual.js";
import type { AsaasMarketplaceHostRetentionAllocation } from "../ports/asaas-marketplace-host-retention.port.js";

export interface AsaasResidualReturnOutbound {
  id: string; merchantId: string; destination: string; amountCents: number; providerTransferId: string;
}

/** One new refund after one completed V5/V7 generation. The original wallet
 * return has already financed that generation and is never counted again.
 * A whole new outbound return leaves its excess as a liability, not revenue.
 * Host retention is only the host's accounting principal, never a transfer. */
export function allocateAsaasMarketplacePostResidualRefund(input: {
  host: { merchantId: string; walletId: string };
  previous: AsaasMarketplaceResidualAllocation | AsaasMarketplaceHostRetentionAllocation;
  allocation: MarketplaceRefundAllocation;
  operations: AsaasResidualReturnOutbound[];
}) {
  const { host, previous, allocation, operations } = input;
  const cents = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 2_147_483_647;
  const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
  const fail = (): never => { throw Error("marketplace_asaas_post_residual_refund_unavailable"); };
  const retained = previous.version === 7 ? previous.hostRetainedCents : 0;
  if (!id(host.merchantId) || !id(host.walletId) || ![5, 7].includes(previous.version) ||
      ![previous.capturedNetCents, previous.refundedCents, previous.platformRetainedCents, previous.payoutTotalCents,
        retained, allocation.amountCents, allocation.platformDebitCents, allocation.cumulativeRefundCents].every(cents) ||
      !allocation.amountCents || allocation.requiredContributions.length ||
      allocation.cumulativeRefundCents !== previous.refundedCents + allocation.amountCents ||
      allocation.cumulativeRefundCents > previous.capturedNetCents ||
      allocation.platformRemainingCents !== previous.platformRetainedCents - allocation.platformDebitCents ||
      allocation.platformRemainingCents < 0 ||
      previous.refundedCents + previous.payoutTotalCents + previous.platformRetainedCents !== previous.capturedNetCents ||
      previous.version === 7 && (retained <= 0 || previous.outboundPayoutCents !== previous.payoutTotalCents - retained) ||
      !previous.beneficiaries.length || new Set(previous.beneficiaries.map(b => b.merchantId)).size !== previous.beneficiaries.length ||
      allocation.merchantDebits.length !== previous.beneficiaries.length ||
      new Set(allocation.merchantDebits.map(d => d.merchantId)).size !== previous.beneficiaries.length ||
      allocation.remainingBeneficiaries.length !== previous.beneficiaries.length ||
      new Set(allocation.remainingBeneficiaries.map(b => b.merchantId)).size !== previous.beneficiaries.length ||
      previous.beneficiaries.some(b => !id(b.merchantId) || !id(b.destination) || !cents(b.amountCents) || !cents(b.providerFeeCents)) ||
      previous.beneficiaries.reduce((s, b) => s + b.amountCents, 0) !== previous.payoutTotalCents) fail();
  const outbound = previous.beneficiaries.filter(b => b.amountCents > 0 && b.destination !== host.walletId);
  const self = previous.beneficiaries.filter(b => b.amountCents > 0 && b.destination === host.walletId);
  if (previous.version === 7 ? self.length !== 1 || self[0]!.merchantId !== host.merchantId || self[0]!.amountCents !== retained : self.length !== 0) fail();
  if (operations.length !== outbound.length || new Set(operations.map(o => o.id)).size !== operations.length ||
      new Set(operations.map(o => o.merchantId)).size !== operations.length ||
      new Set(operations.map(o => o.providerTransferId)).size !== operations.length || operations.some(o => {
        const b = outbound.find(b => b.merchantId === o.merchantId);
        return !b || !id(o.id) || !id(o.providerTransferId) || o.destination !== b.destination || o.amountCents !== b.amountCents ||
          o.merchantId === host.merchantId || o.destination === host.walletId;
      })) fail();
  let seller: { operation: AsaasResidualReturnOutbound; debitCents: number } | undefined;
  let hostDebitCents = 0, merchantDebitCents = 0;
  for (const debit of allocation.merchantDebits) {
    const b = previous.beneficiaries.find(b => b.merchantId === debit.merchantId);
    const remaining = allocation.remainingBeneficiaries.find(r => r.merchantId === debit.merchantId);
    if (!b || !remaining || !cents(debit.amountCents) || debit.amountCents > b.amountCents ||
        remaining.amountCents !== b.amountCents - debit.amountCents || remaining.providerFeeCents !== b.providerFeeCents) return fail();
    merchantDebitCents += debit.amountCents;
    if (!debit.amountCents) continue;
    if (debit.merchantId === host.merchantId && previous.version === 7 && b.destination === host.walletId) {
      hostDebitCents = debit.amountCents;
    } else {
      const operation = operations.find(o => o.merchantId === debit.merchantId);
      if (!operation || seller) fail();
      seller = { operation: operation!, debitCents: debit.amountCents };
    }
  }
  if (!seller || merchantDebitCents !== allocation.merchantDebitCents ||
      merchantDebitCents + allocation.platformDebitCents !== allocation.amountCents || hostDebitCents > retained) fail();
  return { requiredOperationId: seller!.operation.id, sellerMerchantId: seller!.operation.merchantId,
    returnedPrincipalCents: seller!.operation.amountCents, sellerDebitCents: seller!.debitCents,
    heldSellerExcessCents: seller!.operation.amountCents - seller!.debitCents,
    hostDebitCents, hostRetainedAfterRefundCents: retained - hostDebitCents,
    platformDebitCents: allocation.platformDebitCents, platformRetainedAfterRefundCents: allocation.platformRemainingCents };
}
