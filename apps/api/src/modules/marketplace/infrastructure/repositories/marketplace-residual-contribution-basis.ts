import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import { buildMarketplaceRefundContributionPlan, type MarketplaceRefundContributionBasis } from "../../domain/services/marketplace-refund-contribution.js";
import { readMarketplaceRefundContributionCredits } from "./prisma-marketplace-refund-contribution.repository.js";
import { fundingHash, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";

/** Read-only reconstruction under the caller's original order lock. It is also
 * exported for the readiness audit; no journal, consent or credit is created. */
export async function readMarketplaceResidualContributionBasis(tx: Prisma.TransactionClient, input: {
  funding: { paymentIntentId: string; hostMerchantId: string; instructionsHash: string };
  instructions: FrozenMarketplaceFunding; budget: FundingBudget;
  refunds: Array<{ id: string; allocationHash: string; allocation: unknown }>;
}) {
  const certificates = await readMarketplaceRefundContributionCredits(tx, input.funding.paymentIntentId);
  if (!certificates.length) return undefined;
  const lines = await tx.crossStoreLineItem.findMany({ where: { hostMerchantId: input.funding.hostMerchantId,
    orderId: input.budget.capture.providerPaymentId } });
  const identities = [...lines.map(row => {
    const original = input.budget.lines.find(line => line.lineItemId === row.id);
    if (!row.sourceVariantId || !original || original.sellerMerchantId !== row.sellerMerchantId ||
        original.grossAmountCents !== row.unitPriceCents * row.quantity || original.commissionCents !== row.commissionCents) {
      throw new ConflictException("marketplace_residual_contribution_line_changed");
    }
    return { lineItemId: row.id, variantId: row.sourceVariantId, quantity: row.quantity };
  }), ...(input.instructions.hostStockItems ?? []).map(row => ({ lineItemId: row.lineItemId, variantId: row.variantId, quantity: row.quantity }))];
  const basis: MarketplaceRefundContributionBasis = { fundingPlanId: input.funding.paymentIntentId,
    hostMerchantId: input.funding.hostMerchantId, instructionsHash: input.funding.instructionsHash,
    budgetHash: fundingHash(input.budget), instructions: input.instructions, budget: input.budget, identities,
    refunds: input.refunds.map(row => ({ refundPlanId: row.id, allocationHash: row.allocationHash,
      allocation: row.allocation as MarketplaceRefundAllocation })) };
  const plan = buildMarketplaceRefundContributionPlan(basis, certificates);
  if (!plan.fullyFunded) throw new ConflictException("marketplace_residual_contribution_unfunded");
  return { basis, funding: { planHash: plan.planHash, contributedNetCents: plan.contributedNetCents, certificates } };
}
