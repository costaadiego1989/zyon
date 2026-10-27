import type { MarketplaceRefundRequest } from "./marketplace-refund-provider.port.js";
import type { MarketplaceResidualRequest } from "./marketplace-residual-provider.port.js";
import type { MarketplaceRefundContributionBasis } from "../services/marketplace-refund-contribution.js";
import type { MarketplaceResidualBasisV4 } from "../services/marketplace-residual-allocation.js";
import type { MarketplaceResidualAllocationV4 } from "../services/marketplace-residual-sources.js";

/** Completed V4 journal. Repository admission independently binds every row,
 * claim, native receipt, allocation and refund prefix under the original lock. */
export interface StripeMarketplaceSourceResidualSnapshot {
  residualPlanId: string;
  generation: number;
  basis: MarketplaceResidualBasisV4;
  basisHash: string;
  allocation: MarketplaceResidualAllocationV4;
  allocationHash: string;
  operations: Array<{ operationId: string; merchantId: string; sourceId: string;
    providerTransferId: string; request: MarketplaceResidualRequest }>;
}
export interface StripeMarketplaceSourceRefundHistory {
  refundPlanId: string;
  returnId: string;
  providerOperationId: string;
  planHash: string;
  reversals: Array<{ payoutId: string; providerOperationId: string; amountCents: number;
    reference: string; requestHash: string }>;
}
/** No new fee collection, later residual generation or dispute composition.
 * Only the original V4 certificates can finance subsequent buyer refunds. */
export interface StripeMarketplaceSourceRefundContext {
  version: 1;
  kind: "stripe_v4_refund_sources";
  basis: MarketplaceRefundContributionBasis;
  residual: StripeMarketplaceSourceResidualSnapshot;
  history: StripeMarketplaceSourceRefundHistory[];
  refundPlanId: string;
  returnId: string;
}
export interface StripeMarketplaceSourceRefundPlan {
  version: 1;
  kind: "stripe_v4_refund_sources";
  contextHash: string;
  refundPlanId: string;
  amountCents: number;
  cumulativeRefundCents: number;
  sources: Array<{ sourceId: string; chargeId: string; creditedNetCents: number;
    refundedBeforeCents: number; refundDebitCents: number; refundedAfterCents: number;
    netTransferredBeforeCents: number; reversalCents: number;
    platformBeforeCents: number; platformAfterCents: number;
    availableBeforeCents: number; availableAfterCents: number;
    beneficiaryBalances: Array<{ merchantId: string; availableBeforeCents: number; availableAfterCents: number }> }>;
  requiredReversals: Array<{ payoutId: string; sourceId: string; merchantId: string; amountCents: number }>;
  planHash: string;
}
export interface StripeMarketplaceSourceRefundFunding {
  context: StripeMarketplaceSourceRefundContext;
  plan: StripeMarketplaceSourceRefundPlan;
}
export type StripeMarketplaceSourceRefundRequest = MarketplaceRefundRequest & {
  stripeSourceFunding: StripeMarketplaceSourceRefundFunding;
};
