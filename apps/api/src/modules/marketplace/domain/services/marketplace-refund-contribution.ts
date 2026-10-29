import { createHash } from "node:crypto";
import type { MarketplaceRefundContributionCertificate, MarketplaceRefundContributionProof, MarketplaceRefundContributionRequest } from "../ports/marketplace-refund-contribution.port.js";
import { buildMarketplaceFundingBudget, type FrozenMarketplaceFunding } from "./marketplace-funding-budget.js";
import { buildMarketplaceRefundAllocation, type MarketplaceRefundAllocation, type MarketplaceRefundLineIdentity } from "./marketplace-refund-allocation.js";

const canonical = (value: unknown): string => JSON.stringify(value, (_, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
export const marketplaceContributionHash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const cents = (value: unknown, positive = false): value is number => typeof value === "number" && Number.isSafeInteger(value) &&
  value >= (positive ? 1 : 0) && value <= 2_147_483_647;
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 255 && value === value.trim();
function fail(): never { throw new Error("marketplace_refund_contribution_invalid"); }

export interface MarketplaceContributionRefund {
  refundPlanId: string;
  allocationHash: string;
  allocation: MarketplaceRefundAllocation;
}
export interface MarketplaceRefundContributionBasis {
  fundingPlanId: string;
  hostMerchantId: string;
  instructionsHash: string;
  budgetHash: string;
  instructions: FrozenMarketplaceFunding;
  budget: ReturnType<typeof buildMarketplaceFundingBudget>;
  identities: MarketplaceRefundLineIdentity[];
  /** Confirmed predecessors followed by the current prepared/blocked refund.
   * The caller verifies committed status and absence of submitted payouts. */
  refunds: MarketplaceContributionRefund[];
}
export interface MarketplaceRefundContributionPlan {
  version: 1;
  scope: "stripe_refund_before_payout";
  fundingPlanId: string;
  hostMerchantId: string;
  refundPlanId: string;
  instructionsHash: string;
  budgetHash: string;
  basisHash: string;
  requirements: Array<{ merchantId: string; providerFeeCents: number; requiredCents: number;
    creditedCents: number; outstandingCents: number; contributionProcessingFeeCents: number }>;
  credits: Array<{ contributionId: string; certificateHash: string }>;
  cumulativeRefundCents: number;
  contributedNetCents: number;
  contributionProcessingFeeCents: number;
  remainingBeneficiaries: Array<{ merchantId: string; amountCents: number; providerFeeCents: number }>;
  platformRemainingCents: number;
  /** Domain budget only. Does not certify provider admission, release a hold,
   * claim a refund, discharge a debt, or permit publication. */
  fullyFunded: boolean;
  planHash: string;
}

function base(input: MarketplaceRefundContributionBasis) {
  const { instructions: original, budget, refunds } = input;
  if (!text(input.fundingPlanId) || input.hostMerchantId !== original.hostMerchantId || original.provider !== "stripe" ||
      budget.capture.provider !== "stripe" || !/^pi_[A-Za-z0-9_]+$/.test(budget.capture.providerPaymentId) ||
      !/^ch_[A-Za-z0-9_]+$/.test(budget.capture.sourceId) || !/^txn_[A-Za-z0-9_]+$/.test(budget.capture.balanceTransactionId ?? "") ||
      !validHash(input.instructionsHash) || !validHash(input.budgetHash) || marketplaceContributionHash(original) !== input.instructionsHash ||
      marketplaceContributionHash(budget) !== input.budgetHash || marketplaceContributionHash(buildMarketplaceFundingBudget(original, budget.capture)) !== input.budgetHash ||
      !Array.isArray(refunds) || !refunds.length || refunds.length > 2000 ||
      new Set(refunds.map(row => row.refundPlanId)).size !== refunds.length ||
      refunds.some(row => !text(row.refundPlanId) || !validHash(row.allocationHash))) fail();
  const previous: MarketplaceRefundAllocation[] = [];
  for (const row of refunds) {
    const a = row.allocation;
    if (a.policy.commission !== "refund" || a.policy.platformFees !== "refund" || a.policy.hostPlatformFee !== "refund" ||
        marketplaceContributionHash(a) !== row.allocationHash) fail();
    const recomputed = buildMarketplaceRefundAllocation({ instructions: original, budget, identities: input.identities,
      items: a.lines.map(line => ({ variantId: line.variantId, quantity: line.quantity })),
      components: { ...a.policy, buyerServiceFeeCents: a.buyerServiceFeeCents, shipping: a.shipping }, previous });
    if (marketplaceContributionHash(recomputed) !== row.allocationHash) fail();
    previous.push(recomputed);
  }
  const allocation = previous.at(-1)!;
  const requirements = allocation.requiredContributions.map(row => {
    const beneficiary = budget.beneficiaries.find(b => b.merchantId === row.merchantId);
    // This bounded flow covers original seller PSP costs only. Platform or
    // commercial fee deficits require a separately modelled agreement.
    if (!beneficiary || !cents(row.amountCents, true) || row.amountCents > beneficiary.providerFeeCents) fail();
    return { merchantId: beneficiary.merchantId, providerFeeCents: beneficiary.providerFeeCents, requiredCents: row.amountCents };
  }).sort((a, b) => a.merchantId < b.merchantId ? -1 : a.merchantId > b.merchantId ? 1 : 0);
  if (new Set(requirements.map(row => row.merchantId)).size !== requirements.length || allocation.platformRemainingCents < 0) fail();
  const basisHash = marketplaceContributionHash({ version: 1, scope: "stripe_refund_before_payout", fundingPlanId: input.fundingPlanId,
    hostMerchantId: input.hostMerchantId, instructionsHash: input.instructionsHash, budgetHash: input.budgetHash,
    identities: [...input.identities].sort((a, b) => a.lineItemId < b.lineItemId ? -1 : a.lineItemId > b.lineItemId ? 1 : 0),
    refunds: refunds.map(({ refundPlanId, allocationHash }) => ({ refundPlanId, allocationHash })) });
  return { requirements, allocation, basisHash };
}

function state(input: MarketplaceRefundContributionBasis, validated: MarketplaceRefundContributionCertificate[]): MarketplaceRefundContributionPlan {
  const b = base(input);
  const requirements = b.requirements.map(row => {
    const receipts = validated.filter(c => c.request.merchantId === row.merchantId);
    const creditedCents = receipts.reduce((sum, c) => sum + c.creditCents, 0);
    if (!cents(creditedCents) || creditedCents > row.requiredCents) fail();
    return { ...row, creditedCents, outstandingCents: row.requiredCents - creditedCents,
      contributionProcessingFeeCents: receipts.reduce((sum, c) => sum + c.processingFeeCents, 0) };
  });
  if (validated.some(c => !requirements.some(row => row.merchantId === c.request.merchantId))) fail();
  const contributedNetCents = validated.reduce((sum, c) => sum + c.creditCents, 0);
  const contributionProcessingFeeCents = validated.reduce((sum, c) => sum + c.processingFeeCents, 0);
  if (!cents(contributedNetCents) || !cents(contributionProcessingFeeCents)) fail();
  const remainingBeneficiaries = b.allocation.remainingBeneficiaries.map(row => ({ ...row,
    amountCents: row.amountCents + (requirements.find(r => r.merchantId === row.merchantId)?.creditedCents ?? 0) }));
  if (remainingBeneficiaries.reduce((sum, row) => sum + row.amountCents, b.allocation.platformRemainingCents) +
      b.allocation.cumulativeRefundCents !== input.budget.capture.netAmountCents + contributedNetCents) fail();
  const raw = { version: 1 as const, scope: "stripe_refund_before_payout" as const, fundingPlanId: input.fundingPlanId,
    hostMerchantId: input.hostMerchantId, refundPlanId: input.refunds.at(-1)!.refundPlanId,
    instructionsHash: input.instructionsHash, budgetHash: input.budgetHash, basisHash: b.basisHash,
    requirements, credits: validated.map(c => ({ contributionId: c.request.contributionId, certificateHash: c.certificateHash })),
    cumulativeRefundCents: b.allocation.cumulativeRefundCents, contributedNetCents, contributionProcessingFeeCents,
    remainingBeneficiaries, platformRemainingCents: b.allocation.platformRemainingCents,
    fullyFunded: requirements.every(row => row.outstandingCents === 0) };
  return { ...raw, planHash: marketplaceContributionHash(raw) };
}

export function validMarketplaceRefundContributionRequest(r: MarketplaceRefundContributionRequest): boolean {
  const { requestHash, ...raw } = r;
  return r.version === 1 && r.reason === "refund_processing_fee_contribution" && r.provider === "stripe" && r.method === "card" &&
    ["test", "live"].includes(r.environment) && r.currency === "BRL" && text(r.accountFingerprint) &&
    [r.fundingPlanId, r.hostMerchantId, r.refundPlanId, r.merchantId, r.contributionId, r.authorisationId].every(text) &&
    [r.instructionsHash, r.budgetHash, r.planHash, requestHash].every(validHash) &&
    /^acct_[A-Za-z0-9_]+$/.test(r.sellerDestination) && /^cus_[A-Za-z0-9_]+$/.test(r.customerId) &&
    /^pi_[A-Za-z0-9_]+$/.test(r.originalPaymentIntentId) && /^pi_[A-Za-z0-9_]+$/.test(r.providerPaymentIntentId) &&
    r.originalPaymentIntentId !== r.providerPaymentIntentId && /^ch_[A-Za-z0-9_]+$/.test(r.originalChargeId) &&
    /^txn_[A-Za-z0-9_]+$/.test(r.originalBalanceTransactionId) && Number.isFinite(Date.parse(r.authorisedAt)) &&
    cents(r.grossAmountCents, true) && cents(r.maximumCreditCents, true) &&
    /^mcontribution_[a-f0-9]{64}$/.test(r.reference) && (r.collection === undefined || r.collection.journalId === r.contributionId &&
      validHash(r.collection.requestHash) && /^mcollect_[a-f0-9]{64}$/.test(r.collection.reference)) && marketplaceContributionHash(raw) === requestHash;
}
export const marketplaceContributionMetadata = (r: MarketplaceRefundContributionRequest): MarketplaceRefundContributionProof["paymentIntent"]["metadata"] =>
  ({ reason: r.reason, contributionId: r.contributionId, fundingPlanId: r.fundingPlanId, refundPlanId: r.refundPlanId,
    merchantId: r.merchantId, requestHash: r.collection?.requestHash ?? r.requestHash, reference: r.collection?.reference ?? r.reference });

/** Certifies this separate payment's available net. It never treats a chargeback
 * principal certificate, transfer reversal, estimate or payment status as funds. */
export function buildMarketplaceRefundContributionCertificate(request: MarketplaceRefundContributionRequest,
  proof: MarketplaceRefundContributionProof): MarketplaceRefundContributionCertificate | undefined {
  const { paymentIntent: pi, charge: ch, balance: bt } = proof;
  if (!validMarketplaceRefundContributionRequest(request) || marketplaceContributionHash(request) !== marketplaceContributionHash(proof.request) ||
      proof.provider !== "stripe" || proof.accountFingerprint !== request.accountFingerprint ||
      !Number.isFinite(Date.parse(proof.observedAt)) || Date.parse(proof.observedAt) < Date.parse(request.authorisedAt) ||
      !pi || !ch || !bt || pi.id !== request.providerPaymentIntentId || pi.status !== "succeeded" ||
      pi.amountCents !== request.grossAmountCents || pi.receivedAmountCents !== request.grossAmountCents || pi.currency !== "BRL" ||
      pi.environment !== request.environment || pi.customerId !== request.customerId || pi.latestChargeId !== ch.id ||
      pi.applicationFeeCents !== null || pi.onBehalfOf !== null || pi.transferDestination !== null ||
      marketplaceContributionHash(pi.metadata) !== marketplaceContributionHash(marketplaceContributionMetadata(request)) ||
      !/^ch_[A-Za-z0-9_]+$/.test(ch.id) || ch.id === request.originalChargeId || ch.paymentIntentId !== pi.id ||
      ch.customerId !== request.customerId || ch.paymentMethodType !== "card" || ch.amountCents !== request.grossAmountCents || ch.currency !== "BRL" ||
      ch.environment !== request.environment || ch.status !== "succeeded" || ch.paid !== true || ch.captured !== true || ch.disputed !== false ||
      ch.refundedAmountCents !== 0 || ch.refundsComplete !== true || !Array.isArray(ch.refundIds) || ch.refundIds.length !== 0 ||
      ch.transferId !== null || ch.applicationFeeCents !== null || ch.balanceTransactionId !== bt.id ||
      !/^txn_[A-Za-z0-9_]+$/.test(bt.id) || bt.id === request.originalBalanceTransactionId || bt.sourceId !== ch.id ||
      bt.type !== "charge" || bt.status !== "available" || bt.currency !== "BRL" || bt.amountCents !== request.grossAmountCents ||
      !cents(bt.feeCents) || !cents(bt.netCents, true) || bt.amountCents - bt.feeCents !== bt.netCents ||
      !request.collection && bt.netCents > request.maximumCreditCents) return undefined;
  const raw = { version: 1 as const, reason: "refund_processing_fee_contribution_credit" as const,
    request: structuredClone(request), proof: structuredClone(proof), creditCents: Math.min(bt.netCents,request.maximumCreditCents), processingFeeCents: bt.feeCents,
    ...(request.collection ? { excessLiabilityCents: Math.max(0,bt.netCents-request.maximumCreditCents) } : {}) };
  return { ...raw, certificateHash: marketplaceContributionHash(raw) };
}

/** Replays cumulative refund allocation and every preceding certificate. Receipt
 * order is the durable credit sequence; omitting an earlier credit changes the
 * frozen plan hash. Global cross-order uniqueness remains a repository guard. */
export function buildMarketplaceRefundContributionPlan(input: MarketplaceRefundContributionBasis,
  credits: MarketplaceRefundContributionCertificate[] = []): MarketplaceRefundContributionPlan {
  if (!Array.isArray(credits) || credits.length > 2000) fail();
  const validated: MarketplaceRefundContributionCertificate[] = [];
  const seen = [new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>()];
  let lastRefundIndex = -1;
  for (const credit of credits) {
    const r = credit.request;
    const rebuilt = buildMarketplaceRefundContributionCertificate(r, credit.proof);
    if (!rebuilt || marketplaceContributionHash(rebuilt) !== marketplaceContributionHash(credit)) fail();
    const refundIndex = input.refunds.findIndex(row => row.refundPlanId === r.refundPlanId);
    if (refundIndex < lastRefundIndex || refundIndex < 0) fail();
    lastRefundIndex = refundIndex;
    const before = state({ ...input, refunds: input.refunds.slice(0, refundIndex + 1) }, validated);
    const required = before.requirements.find(row => row.merchantId === r.merchantId);
    if (!required || r.planHash !== before.planHash || r.fundingPlanId !== input.fundingPlanId || r.hostMerchantId !== input.hostMerchantId ||
        r.instructionsHash !== input.instructionsHash || r.budgetHash !== input.budgetHash ||
        r.accountFingerprint !== input.instructions.accountFingerprint || r.environment !== input.instructions.environment ||
        r.originalPaymentIntentId !== input.budget.capture.providerPaymentId || r.originalChargeId !== input.budget.capture.sourceId ||
        r.originalBalanceTransactionId !== input.budget.capture.balanceTransactionId ||
        r.sellerDestination !== input.instructions.destinations.find(row => row.merchantId === r.merchantId)?.destination ||
        r.maximumCreditCents !== required.outstandingCents) fail();
    const ids = [r.contributionId, r.providerPaymentIntentId, credit.proof.charge.id, credit.proof.balance.id];
    for (let i = 0; i < ids.length; i++) { if (seen[i]!.has(ids[i]!)) fail(); seen[i]!.add(ids[i]!); }
    validated.push(rebuilt);
  }
  return state(input, validated);
}

/** Plans an explicitly authorised receipt import. Creates no PSP payment and
 * does not infer a customer mapping or permission from connected-account IDs. */
export function buildMarketplaceRefundContributionRequest(input: MarketplaceRefundContributionBasis,
  approval: { merchantId: string; contributionId: string; customerId: string; authorisationId: string;
    authorisedAt: string; providerPaymentIntentId: string; grossAmountCents: number; collection?: MarketplaceRefundContributionRequest["collection"] },
  credits: MarketplaceRefundContributionCertificate[] = []): MarketplaceRefundContributionRequest {
  const plan = buildMarketplaceRefundContributionPlan(input, credits);
  const required = plan.requirements.find(row => row.merchantId === approval.merchantId);
  if (!required?.outstandingCents) fail();
  const raw = { version: 1 as const, reason: "refund_processing_fee_contribution" as const, provider: "stripe" as const, method: "card" as const,
    environment: input.instructions.environment, currency: "BRL" as const, accountFingerprint: input.instructions.accountFingerprint,
    fundingPlanId: input.fundingPlanId, hostMerchantId: input.hostMerchantId, refundPlanId: plan.refundPlanId,
    ...approval, sellerDestination: input.instructions.destinations.find(row => row.merchantId === approval.merchantId)!.destination,
    instructionsHash: input.instructionsHash, budgetHash: input.budgetHash, planHash: plan.planHash,
    originalPaymentIntentId: input.budget.capture.providerPaymentId, originalChargeId: input.budget.capture.sourceId,
    originalBalanceTransactionId: input.budget.capture.balanceTransactionId!, maximumCreditCents: required.outstandingCents,
    reference: `mcontribution_${marketplaceContributionHash([input.fundingPlanId, plan.refundPlanId, approval.merchantId, approval.contributionId])}` };
  const request = { ...raw, requestHash: marketplaceContributionHash(raw) };
  if (!validMarketplaceRefundContributionRequest(request)) fail();
  return request;
}
