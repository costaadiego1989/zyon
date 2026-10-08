import type { StripeMarketplaceSuccessiveResidualAllocation, StripeMarketplaceSuccessiveResidualBasis,
  StripeMarketplaceSuccessiveResidualGenerationProof, StripeMarketplaceSuccessiveResidualGenerationRequest,
  StripeMarketplaceSuccessiveResidualRequest, StripeMarketplaceSuccessiveResidualTransferReceipt } from "../ports/stripe-marketplace-successive-residual.port.js";
import { buildStripeMarketplaceSourceRefundPlan, buildStripeMarketplaceSourceRefundRequest } from "./marketplace-stripe-source-refund.js";
import { buildMarketplaceRefundContributionPlan, marketplaceContributionHash as hash } from "./marketplace-refund-contribution.js";

const cents = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 2_147_483_647;
const text = (n: unknown): n is string => typeof n === "string" && n === n.trim() && !!n && n.length <= 255;
function fail(): never { throw Error("marketplace_stripe_successive_residual_invalid"); }

export function buildStripeMarketplaceSuccessiveResidualAllocation(b: StripeMarketplaceSuccessiveResidualBasis): StripeMarketplaceSuccessiveResidualAllocation {
  const f = b.sourceRefundFunding, c = f.context, initial = c.residual, latest = b.completedRefund;
  const p = buildStripeMarketplaceSourceRefundPlan(c), request = buildStripeMarketplaceSourceRefundRequest(c, p);
  if (b.version !== 6 || b.kind !== "stripe_v4_successive_residual" || b.fundingPlanId !== c.basis.fundingPlanId ||
      b.instructionsHash !== c.basis.instructionsHash || b.budgetHash !== c.basis.budgetHash || hash(f.plan) !== hash(p) ||
      latest.refundPlanId !== c.refundPlanId || latest.returnId !== c.returnId || latest.planHash !== p.planHash ||
      latest.requestHash !== request.requestHash || latest.amountCents !== p.amountCents || !/^re_[A-Za-z0-9_]+$/.test(latest.providerOperationId) ||
      b.previousGenerations.length !== 1 || hash(b.previousGenerations[0]) !== hash({ residualPlanId: initial.residualPlanId,
        generation: 1, basisHash: initial.basisHash, allocationHash: initial.allocationHash }) ||
      latest.reversals.length !== p.requiredReversals.length || new Set(latest.reversals.map(r => r.payoutId)).size !== latest.reversals.length) fail();
  const reversalIds = new Set(c.history.flatMap(h => h.reversals.map(r => r.providerOperationId)));
  for (const r of latest.reversals) {
    const expected = p.requiredReversals.find(e => e.payoutId === r.payoutId);
    const expectedRequest = expected && buildStripeMarketplaceSourceRefundRequest(c, p, r.payoutId);
    if (!expected || !expectedRequest || r.amountCents !== expected.amountCents || r.reference !== expectedRequest.reference ||
        r.requestHash !== expectedRequest.requestHash || !/^trr_[A-Za-z0-9_]+$/.test(r.providerOperationId) || reversalIds.has(r.providerOperationId)) fail();
    reversalIds.add(r.providerOperationId);
  }
  const receipts = [...initial.basis.refunds, ...c.history.map(h => { const a = c.basis.refunds.find(r => r.refundPlanId === h.refundPlanId)!;
    return { refundPlanId: h.refundPlanId, returnId: h.returnId, allocationHash: a.allocationHash,
      requestHash: buildStripeMarketplaceSourceRefundRequest({ ...c, refundPlanId: h.refundPlanId, returnId: h.returnId,
        basis: { ...c.basis, refunds: c.basis.refunds.slice(0, c.basis.refunds.indexOf(a) + 1) }, history: c.history.slice(0, c.history.indexOf(h)) }).requestHash,
      providerOperationId: h.providerOperationId, amountCents: a.allocation.amountCents }; }),
    { refundPlanId: latest.refundPlanId, returnId: latest.returnId, allocationHash: c.basis.refunds.at(-1)!.allocationHash,
      requestHash: latest.requestHash, providerOperationId: latest.providerOperationId, amountCents: latest.amountCents }];
  if (hash(receipts) !== hash(b.refunds) || new Set(receipts.map(r => r.providerOperationId)).size !== receipts.length) fail();
  const allReversals = [...c.history.flatMap(h => h.reversals), ...latest.reversals];
  const net = initial.operations.map(o => ({ ...o, amountCents: o.request.amountCents - allReversals.filter(r => r.payoutId === o.operationId)
    .reduce((sum, r) => sum + r.amountCents, 0) }));
  if (net.some(o => !cents(o.amountCents))) fail();
  const sources = initial.allocation.sources.map((s, i) => {
    const state = p.sources[i]!;
    const alreadyTransferredCents = net.filter(o => o.sourceId === s.sourceId).reduce((sum, o) => sum + o.amountCents, 0);
    const grossTransferredCents = initial.operations.filter(o => o.sourceId === s.sourceId).reduce((sum, o) => sum + o.request.amountCents, 0);
    const beneficiaries = state.beneficiaryBalances.filter(row => row.availableAfterCents > 0).map(row => {
      const frozen = c.basis.budget.beneficiaries.find(frozen => frozen.merchantId === row.merchantId);
      if (!frozen) fail();
      return { merchantId: row.merchantId, destination: frozen.destination, amountCents: row.availableAfterCents };
    }).sort((a, b) => a.merchantId.localeCompare(b.merchantId));
    const payoutTotalCents = beneficiaries.reduce((sum, row) => sum + row.amountCents, 0);
    if (alreadyTransferredCents !== state.netTransferredBeforeCents - state.reversalCents || payoutTotalCents !== state.availableAfterCents ||
        ![alreadyTransferredCents, grossTransferredCents, payoutTotalCents].every(cents) || grossTransferredCents + payoutTotalCents > s.capturedGrossCents ||
        s.creditedNetCents !== state.refundedAfterCents + state.platformAfterCents + alreadyTransferredCents + payoutTotalCents) fail();
    return { sourceId: s.sourceId, chargeId: s.chargeId, balanceTransactionId: s.balanceTransactionId,
      capturedGrossCents: s.capturedGrossCents, processingFeeCents: s.processingFeeCents, creditedNetCents: s.creditedNetCents,
      refundedCents: state.refundedAfterCents, platformRetainedCents: state.platformAfterCents, grossTransferredCents,
      alreadyTransferredCents, availableCents: state.availableAfterCents, payoutTotalCents, beneficiaries };
  });
  const entitlement = buildMarketplaceRefundContributionPlan(c.basis, initial.basis.fundingContributions.certificates);
  if (!entitlement.fullyFunded) fail();
  const beneficiaries = c.basis.budget.beneficiaries.map(frozen => {
    const amountCents = sources.flatMap(s => s.beneficiaries).filter(row => row.merchantId === frozen.merchantId).reduce((sum, row) => sum + row.amountCents, 0);
    const alreadyTransferredCents = net.filter(o => o.merchantId === frozen.merchantId).reduce((sum, o) => sum + o.amountCents, 0);
    const remainingEntitlementCents = entitlement.remainingBeneficiaries.find(row => row.merchantId === frozen.merchantId)?.amountCents;
    if (!cents(amountCents) || !cents(alreadyTransferredCents) || remainingEntitlementCents === undefined || remainingEntitlementCents !== amountCents + alreadyTransferredCents) fail();
    return { merchantId: frozen.merchantId, destination: frozen.destination, amountCents, providerFeeCents: frozen.providerFeeCents,
      alreadyTransferredCents, remainingEntitlementCents };
  }).sort((a, b) => a.merchantId.localeCompare(b.merchantId));
  const payoutTotalCents = sources.reduce((sum, s) => sum + s.payoutTotalCents, 0), alreadyTransferredCents = sources.reduce((sum, s) => sum + s.alreadyTransferredCents, 0);
  if (sources.reduce((sum, s) => sum + s.refundedCents, 0) !== p.cumulativeRefundCents ||
      p.cumulativeRefundCents + alreadyTransferredCents + payoutTotalCents + entitlement.platformRemainingCents !==
        c.basis.budget.capture.netAmountCents + initial.allocation.contributedNetCents) fail();
  return { version: 6, kind: "stripe_v4_successive_residual", capturedNetCents: c.basis.budget.capture.netAmountCents,
    contributedNetCents: initial.allocation.contributedNetCents, contributionProcessingFeeCents: initial.allocation.contributionProcessingFeeCents,
    excessLiabilityCents: initial.allocation.excessLiabilityCents, refundedCents: p.cumulativeRefundCents,
    platformRetainedCents: entitlement.platformRemainingCents, alreadyTransferredCents, payoutTotalCents, beneficiaries, sources };
}

export function buildStripeMarketplaceSuccessiveResidualRequest(basis: StripeMarketplaceSuccessiveResidualBasis, sourceId: string,
  merchantId: string): StripeMarketplaceSuccessiveResidualRequest {
  const allocation = buildStripeMarketplaceSuccessiveResidualAllocation(basis), source = allocation.sources.find(s => s.sourceId === sourceId);
  const beneficiary = source?.beneficiaries.find(b => b.merchantId === merchantId);
  if (!source || !beneficiary) fail();
  const basisHash = hash(basis), allocationHash = hash(allocation), c = basis.sourceRefundFunding.context;
  const reference = (merchant: string) => `mresidual_${hash([c.basis.hostMerchantId, basis.fundingPlanId, basisHash, sourceId, merchant])}`;
  const raw = { version: 6 as const, provider: "stripe" as const, accountFingerprint: c.basis.budget.capture.accountFingerprint,
    providerPaymentId: c.basis.budget.capture.providerPaymentId, destination: beneficiary.destination, amountCents: beneficiary.amountCents,
    currency: "BRL" as const, reference: reference(merchantId), capture: c.basis.budget.capture, sourceId, beneficiaryMerchantId: merchantId,
    basisHash, allocationHash, stripeSuccessiveFunding: { basis, allocation }, remainingTotalCents: source.payoutTotalCents,
    transfers: source.beneficiaries.map(b => ({ reference: reference(b.merchantId), destination: b.destination, amountCents: b.amountCents })),
    refunds: basis.refunds.map(r => ({ providerOperationId: r.providerOperationId, amountCents: r.amountCents })) };
  return { ...raw, requestHash: hash(raw) };
}
export function stripeSuccessiveResidualRequests(basis: StripeMarketplaceSuccessiveResidualBasis): StripeMarketplaceSuccessiveResidualRequest[] {
  return buildStripeMarketplaceSuccessiveResidualAllocation(basis).sources.flatMap(s => s.beneficiaries.map(b => buildStripeMarketplaceSuccessiveResidualRequest(basis, s.sourceId, b.merchantId)));
}
export function stripeSuccessiveResidualMetadata(r: StripeMarketplaceSuccessiveResidualRequest) {
  return { marketplace_reference: r.reference, marketplace_request_hash: r.requestHash, payment_intent_id: r.providerPaymentId,
    marketplace_operation: "residual_payout", marketplace_source_id: r.sourceId, marketplace_residual_generation: "2",
    marketplace_basis_hash: r.basisHash, marketplace_allocation_hash: r.allocationHash };
}
export function buildStripeMarketplaceSuccessiveResidualGenerationRequest(basis: StripeMarketplaceSuccessiveResidualBasis,
  residualPlanId: string): StripeMarketplaceSuccessiveResidualGenerationRequest {
  if (!text(residualPlanId) || residualPlanId === basis.sourceRefundFunding.context.residual.residualPlanId) fail();
  const allocation = buildStripeMarketplaceSuccessiveResidualAllocation(basis), basisHash = hash(basis), allocationHash = hash(allocation), c = basis.sourceRefundFunding.context;
  const raw = { version: 1 as const, kind: "stripe_v4_successive_residual_certification" as const, provider: "stripe" as const,
    environment: c.basis.budget.capture.environment, accountFingerprint: c.basis.budget.capture.accountFingerprint,
    hostMerchantId: c.basis.hostMerchantId, fundingPlanId: basis.fundingPlanId, residualPlanId, generation: 2 as const,
    basis, basisHash, allocation, allocationHash, reference: `mresidual_generation_${hash([c.basis.hostMerchantId, basis.fundingPlanId, basisHash, allocationHash])}` };
  return { ...raw, requestHash: hash(raw) };
}
export function validStripeSuccessiveResidualTransferReceipt(r: StripeMarketplaceSuccessiveResidualRequest,
  proof: StripeMarketplaceSuccessiveResidualTransferReceipt): boolean {
  try {
  const source = r.stripeSuccessiveFunding.allocation.sources.find(s => s.sourceId === r.sourceId);
  if (!source || !proof?.balance) return false;
  return proof.sourceId === r.sourceId && proof.merchantId === r.beneficiaryMerchantId && proof.reference === r.reference &&
    proof.requestHash === r.requestHash && /^tr_[A-Za-z0-9_]+$/.test(proof.providerTransferId) && proof.chargeId === source.chargeId &&
    proof.destination === r.destination && proof.amountCents === r.amountCents && /^txn_[A-Za-z0-9_]+$/.test(proof.balance.id) &&
    proof.balance.sourceId === proof.providerTransferId && proof.balance.type === "transfer" && proof.balance.currency === "BRL" &&
    proof.balance.status === "available" && proof.balance.amountCents === -r.amountCents && proof.balance.netCents === -r.amountCents && proof.balance.feeCents === 0;
  } catch { return false; }
}
export function validStripeSuccessiveResidualGenerationProof(r: StripeMarketplaceSuccessiveResidualGenerationRequest,
  proof: StripeMarketplaceSuccessiveResidualGenerationProof, now = new Date()): boolean {
  try {
    const requests = stripeSuccessiveResidualRequests(r.basis), observed = Date.parse(proof.observedAt);
    if (hash(r) !== hash(buildStripeMarketplaceSuccessiveResidualGenerationRequest(r.basis, r.residualPlanId)) ||
        proof.version !== 1 || proof.kind !== "stripe_v4_successive_residual_certified" || proof.requestHash !== r.requestHash ||
        proof.basisHash !== r.basisHash || proof.allocationHash !== r.allocationHash || proof.accountFingerprint !== r.accountFingerprint ||
        proof.providerRefundId !== r.basis.completedRefund.providerOperationId || proof.sourceInventoryComplete !== true ||
        !Number.isFinite(observed) || observed < now.getTime() - 300_000 || observed > now.getTime() + 60_000 ||
        proof.transferReceipts.length !== requests.length || new Set(proof.transferReceipts.map(p => p.providerTransferId)).size !== requests.length ||
        new Set(proof.transferReceipts.map(p => p.requestHash)).size !== requests.length) return false;
    const { proofHash, ...raw } = proof;
    if (proofHash !== hash(raw)) return false;
    return requests.every(request => proof.transferReceipts.some(p => validStripeSuccessiveResidualTransferReceipt(request, p)));
  } catch { return false; }
}
