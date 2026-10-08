import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { MarketplaceRefundRequest } from "../../domain/ports/marketplace-refund-provider.port.js";
import type { StripeMarketplaceSuccessiveResidualBasis } from "../../domain/ports/stripe-marketplace-successive-residual.port.js";
import { buildStripeMarketplaceSourceRefundRequest } from "../../domain/services/marketplace-stripe-source-refund.js";
import { buildStripeMarketplaceSuccessiveResidualAllocation } from "../../domain/services/stripe-marketplace-successive-residual.js";
import { fundingHash as hash, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { hasMarketplaceRecoveryExposure } from "./marketplace-recovery-exposure.js";

function fail(reason = "marketplace_stripe_successive_residual_history_invalid"): never { throw new ConflictException(reason); }
/** Read committed, receipted source journals under the original order lock.
 * It reconstructs the next unpaid amount rather than replaying paid balances. */
export async function readStripeMarketplaceSuccessiveResidualBasis(tx: Prisma.TransactionClient,
  hostMerchantId: string, paymentIntentId: string) {
  const first = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId, hostMerchantId } });
  if (!first?.providerPaymentId) fail();
  await lockMarketplaceOrder(tx, hostMerchantId, first.providerPaymentId);
  const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId, hostMerchantId } });
  if (!plan?.budget || plan.provider !== "stripe" || plan.status !== "held") fail();
  const instructions = plan.instructions as unknown as FrozenMarketplaceFunding, budget = plan.budget as unknown as FundingBudget;
  if (await tx.outboxMessage.count({ where: { merchantId: hostMerchantId, correlationId: paymentIntentId,
    eventType: "marketplace.financial_reconciliation_required" } })) fail("marketplace_stripe_successive_residual_reconciliation_required");
  for (const row of budget.beneficiaries) if (await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: row.merchantId, status: "outstanding" } }) ||
    await tx.marketplaceHostDebt.count({ where: { hostMerchantId: row.merchantId, status: "outstanding" } }) ||
    await hasMarketplaceRecoveryExposure(tx, row.merchantId)) fail("marketplace_stripe_successive_residual_beneficiary_exposed");
  const refunds = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: paymentIntentId }, include: { operation: true } });
  refunds.sort((a, b) => Number((a.allocation as { cumulativeRefundCents?: number }).cumulativeRefundCents) -
    Number((b.allocation as { cumulativeRefundCents?: number }).cumulativeRefundCents) || a.id.localeCompare(b.id));
  if (refunds.some(r => r.status !== "confirmed" || r.operation?.status !== "confirmed")) fail();
  const latest = refunds.at(-1), operation = latest?.operation;
  const sourceRequest = operation?.request as unknown as MarketplaceRefundRequest | undefined;
  if (!latest || !operation?.providerOperationId || !operation.claimedAt || !operation.reconciledAt || !sourceRequest?.stripeSourceFunding) fail();
  const funding = sourceRequest.stripeSourceFunding, context = funding.context;
  if (hash(sourceRequest) !== hash(buildStripeMarketplaceSourceRefundRequest(context, funding.plan)) ||
    operation.requestHash !== sourceRequest.requestHash || operation.reference !== sourceRequest.reference ||
    context.refundPlanId !== latest.id || context.returnId !== latest.returnId || context.basis.fundingPlanId !== paymentIntentId) fail();
  const reversals = await tx.marketplaceTransferReversal.findMany({ where: { refundPlanId: latest.id } });
  if (reversals.length !== funding.plan.requiredReversals.length || reversals.some(r => r.status !== "confirmed" || !r.claimedAt ||
    !r.reconciledAt || !r.providerOperationId || !r.residualOperationId || r.payoutId || r.provider !== "stripe" || r.accountFingerprint !== plan.accountFingerprint)) fail();
  const basis: StripeMarketplaceSuccessiveResidualBasis = { version: 6, kind: "stripe_v4_successive_residual",
    fundingPlanId: paymentIntentId, instructionsHash: plan.instructionsHash, budgetHash: hash(budget), sourceRefundFunding: funding,
    completedRefund: { refundPlanId: latest.id, returnId: latest.returnId, planHash: funding.plan.planHash,
      providerOperationId: operation.providerOperationId, requestHash: operation.requestHash, amountCents: latest.amountCents,
      reversals: reversals.map(r => ({ payoutId: r.residualOperationId!, providerOperationId: r.providerOperationId!, amountCents: r.amountCents,
        reference: r.reference, requestHash: r.requestHash })).sort((a, b) => a.payoutId.localeCompare(b.payoutId)) },
    refunds: refunds.map(r => ({ refundPlanId: r.id, returnId: r.returnId, allocationHash: r.allocationHash,
      requestHash: r.operation!.requestHash, providerOperationId: r.operation!.providerOperationId!, amountCents: r.amountCents })),
    previousGenerations: [{ residualPlanId: context.residual.residualPlanId, generation: 1,
      basisHash: context.residual.basisHash, allocationHash: context.residual.allocationHash }] };
  const allocation = buildStripeMarketplaceSuccessiveResidualAllocation(basis);
  const valid = await tx.$queryRaw<Array<{ valid: boolean }>>`SELECT marketplace_stripe_successive_residual_basis_valid(${JSON.stringify(basis)}::jsonb, true) AS valid`;
  if (valid[0]?.valid !== true) fail();
  const generations = await tx.marketplaceResidualPlan.findMany({ where: { fundingPlanId: paymentIntentId } });
  if (generations.length < 1 || generations.length > 2 || generations.some(r => r.generation === 1 ? r.id !== context.residual.residualPlanId ||
    r.status !== "completed" || !!r.heldReason : r.generation !== 2 || r.status === "held" || r.basisHash !== hash(basis) ||
      r.allocationHash !== hash(allocation))) fail();
  const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: paymentIntentId } });
  if (!payouts.length || payouts.some(p => p.status !== "planned" || p.claimedAt || p.providerTransferId || !p.dueAt)) fail();
  return { plan, instructions, budget, basis, allocation, profile: "stripe_successive" as const, generation: 2 as const,
    dueAt: new Date(Math.max(...payouts.map(p => p.dueAt!.getTime()))) };
}
