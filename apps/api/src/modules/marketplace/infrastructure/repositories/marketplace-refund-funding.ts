import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { MarketplaceRefundRequest } from "../../domain/ports/marketplace-refund-provider.port.js";
import { buildMarketplaceRefundContributionPlan } from "../../domain/services/marketplace-refund-contribution.js";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import { fundingHash, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { readMarketplaceRefundContributionCredits } from "./prisma-marketplace-refund-contribution.repository.js";

/** The caller holds the original order lock. Replay every durable fee credit,
 * including predecessors; a caller cannot omit a receipt to spend it twice. */
export async function readMarketplaceRefundFunding(tx: Prisma.TransactionClient, hostMerchantId: string,
  funding: { paymentIntentId: string; instructionsHash: string }, instructions: FrozenMarketplaceFunding,
  budget: FundingBudget, refundPlanId: string) {
  const rows = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { operation: true } });
  rows.sort((a, b) => (a.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents -
    (b.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents || a.id.localeCompare(b.id));
  if (!rows.length || rows.at(-1)!.id !== refundPlanId || rows.some((row, index) => row.hostMerchantId !== hostMerchantId ||
      fundingHash(row.allocation) !== row.allocationHash || index < rows.length - 1 && (row.status !== "confirmed" ||
        row.operation?.status !== "confirmed" || !row.operation.providerOperationId || !row.operation.claimedAt || !row.operation.reconciledAt))) {
    throw new ConflictException("marketplace_refund_contribution_history_changed");
  }
  const lines = await tx.crossStoreLineItem.findMany({ where: { hostMerchantId, orderId: budget.capture.providerPaymentId } });
  const identities = [...lines.map(row => {
    const original = budget.lines.find(line => line.lineItemId === row.id);
    if (!row.sourceVariantId || !original || original.sellerMerchantId !== row.sellerMerchantId ||
        original.grossAmountCents !== row.unitPriceCents * row.quantity || original.commissionCents !== row.commissionCents) {
      throw new ConflictException("marketplace_refund_contribution_line_changed");
    }
    return { lineItemId: row.id, variantId: row.sourceVariantId, quantity: row.quantity };
  }), ...(instructions.hostStockItems ?? []).map(row => ({ lineItemId: row.lineItemId, variantId: row.variantId, quantity: row.quantity }))];
  const certificates = await readMarketplaceRefundContributionCredits(tx, funding.paymentIntentId);
  const plan = buildMarketplaceRefundContributionPlan({ fundingPlanId: funding.paymentIntentId, hostMerchantId,
    instructionsHash: funding.instructionsHash, budgetHash: fundingHash(budget), instructions, budget, identities,
    refunds: rows.map(row => ({ refundPlanId: row.id, allocationHash: row.allocationHash,
      allocation: row.allocation as unknown as MarketplaceRefundAllocation })) }, certificates);
  return { plan, certificates };
}

export function assertMarketplaceRefundFunding(request: MarketplaceRefundRequest,
  current: Awaited<ReturnType<typeof readMarketplaceRefundFunding>>): void {
  if (!current.plan.fullyFunded || !request.fundingContributions || current.plan.planHash !== request.fundingContributions.planHash ||
      current.plan.contributedNetCents !== request.fundingContributions.contributedNetCents ||
      fundingHash(current.certificates) !== fundingHash(request.fundingContributions.certificates)) {
    throw new ConflictException("marketplace_refund_contribution_unproven");
  }
}
