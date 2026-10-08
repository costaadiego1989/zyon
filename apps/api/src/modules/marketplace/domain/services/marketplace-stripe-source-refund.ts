import type { MarketplaceRefundRequest } from "../ports/marketplace-refund-provider.port.js";
import type { MarketplaceResidualRequest } from "../ports/marketplace-residual-provider.port.js";
import type { StripeMarketplaceSourceRefundContext, StripeMarketplaceSourceRefundPlan,
  StripeMarketplaceSourceRefundRequest } from "../ports/marketplace-stripe-source-refund.port.js";
import { buildMarketplaceRefundContributionPlan, marketplaceContributionHash as hash } from "./marketplace-refund-contribution.js";
import { buildMarketplaceResidualContributionAllocation } from "./marketplace-residual-sources.js";

const cents = (v: number) => Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647;
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v === v.trim() && v.length <= 255;
function fail(reason = "marketplace_stripe_source_refund_history_invalid"): never { throw Error(reason); }
const previousRefunds = (c: StripeMarketplaceSourceRefundContext): MarketplaceRefundRequest["previousRefunds"] =>
  [...c.residual.basis.refunds.map(r => ({ providerOperationId: r.providerOperationId, amountCents: r.amountCents })),
    ...c.history.map(r => ({ providerOperationId: r.providerOperationId,
      amountCents: c.basis.refunds.find(a => a.refundPlanId === r.refundPlanId)!.allocation.amountCents }))];

/** Rebuilds the exact initial V4 requests, not caller-provided source bindings. */
export function buildStripeMarketplaceSourceResidualRequest(c: StripeMarketplaceSourceRefundContext,
  sourceId: string, merchantId: string): MarketplaceResidualRequest {
  const a = c.residual.allocation, capture = c.basis.budget.capture;
  const source = a.sources.find(s => s.sourceId === sourceId), b = source?.beneficiaries.find(b => b.merchantId === merchantId);
  if (!source || !b) fail();
  const reference = (m: string, s = sourceId) => `mresidual_${hash([c.basis.hostMerchantId, c.basis.fundingPlanId, c.residual.basisHash, s, m])}`;
  const raw = { version: 4 as const, provider: "stripe" as const, accountFingerprint: capture.accountFingerprint,
    providerPaymentId: capture.providerPaymentId, destination: b.destination, amountCents: b.amountCents, currency: "BRL" as const,
    reference: reference(merchantId), capture, sourceId, sourceAllocation: a, fundingContributions: c.residual.basis.fundingContributions,
    sourceTransfers: a.sources.map(s => ({ sourceId: s.sourceId, transfers: s.beneficiaries.map(b => ({
      reference: reference(b.merchantId, s.sourceId), destination: b.destination, amountCents: b.amountCents })) })),
    remainingTotalCents: source.payoutTotalCents, transfers: source.beneficiaries.map(b => ({
      reference: reference(b.merchantId), destination: b.destination, amountCents: b.amountCents })),
    refunds: c.residual.basis.refunds.map(r => ({ providerOperationId: r.providerOperationId, amountCents: r.amountCents })) };
  return { ...raw, requestHash: hash(raw) };
}

function validateBase(c: StripeMarketplaceSourceRefundContext) {
  const r = c.residual, b = c.basis, count = r.basis.refunds.length;
  if (c.version !== 1 || c.kind !== "stripe_v4_refund_sources" || !text(c.refundPlanId) || !text(c.returnId) ||
      !text(r.residualPlanId) || r.generation !== 1 || r.basis.version !== 4 || r.allocation.version !== 4 ||
      b.fundingPlanId !== r.basis.fundingPlanId || b.instructionsHash !== r.basis.instructionsHash || b.budgetHash !== r.basis.budgetHash ||
      r.basisHash !== hash(r.basis) || r.allocationHash !== hash(r.allocation) || !count || count > 2000 ||
      !Array.isArray(c.history) || c.history.length > 2000 || b.refunds.length !== count + c.history.length + 1 ||
      b.refunds.at(-1)?.refundPlanId !== c.refundPlanId || new Set(c.history.map(h => h.refundPlanId)).size !== c.history.length ||
      new Set(c.history.map(h => h.providerOperationId)).size !== c.history.length ||
      c.history.some((h, i) => !text(h.returnId) || !/^re_[A-Za-z0-9_]+$/.test(h.providerOperationId) ||
        h.refundPlanId !== b.refunds[count + i]?.refundPlanId) ||
      r.basis.refunds.some((row, i) => row.refundPlanId !== b.refunds[i]?.refundPlanId ||
        row.allocationHash !== b.refunds[i]?.allocationHash || row.amountCents !== b.refunds[i]?.allocation.amountCents ||
        !text(row.returnId) || !/^[a-f0-9]{64}$/.test(row.requestHash) || !/^re_[A-Za-z0-9_]+$/.test(row.providerOperationId))) fail();
  const returnIds = [...r.basis.refunds.map(row => row.returnId), ...c.history.map(row => row.returnId), c.returnId];
  if (new Set(returnIds).size !== returnIds.length) fail();
  const prefix = { ...b, refunds: b.refunds.slice(0, count) };
  const initial = buildMarketplaceResidualContributionAllocation(prefix, r.basis.fundingContributions);
  if (hash(initial) !== r.allocationHash || !Array.isArray(r.operations) || r.operations.length > 2000 ||
      r.operations.length !== initial.sources.reduce((s, source) => s + source.beneficiaries.length, 0) ||
      new Set(r.operations.map(o => o.operationId)).size !== r.operations.length ||
      new Set(r.operations.map(o => o.providerTransferId)).size !== r.operations.length ||
      new Set(r.operations.map(o => hash([o.sourceId, o.merchantId]))).size !== r.operations.length ||
      r.operations.some(o => !text(o.operationId) || !/^tr_[A-Za-z0-9_]+$/.test(o.providerTransferId) ||
        hash(o.request) !== hash(buildStripeMarketplaceSourceResidualRequest(c, o.sourceId, o.merchantId)))) fail();
  const ids = previousRefunds(c).map(row => row.providerOperationId);
  if (new Set(ids).size !== ids.length) fail();
  return count;
}

function entitlement(c: StripeMarketplaceSourceRefundContext, prefixLength: number) {
  const p = buildMarketplaceRefundContributionPlan({ ...c.basis, refunds: c.basis.refunds.slice(0, prefixLength) },
    c.residual.basis.fundingContributions.certificates);
  if (!p.fullyFunded) fail("marketplace_stripe_source_refund_contribution_required");
  return p;
}

type ReplayState = { reversed: Map<string, number>; refunded: Map<string, number>;
  held: Map<string, Map<string, number>> };
function step(c: StripeMarketplaceSourceRefundContext, count: number, state: ReplayState): StripeMarketplaceSourceRefundPlan {
  const before = entitlement(c, count), after = entitlement(c, count + 1);
  const current = c.basis.refunds[count]!;
  const beforeHeld = new Map([...state.held].map(([sourceId, values]) => [sourceId, new Map(values)]));
  const ordered = [...c.residual.operations].sort((a, b) => c.residual.allocation.sources.findIndex(s => s.sourceId === a.sourceId) -
    c.residual.allocation.sources.findIndex(s => s.sourceId === b.sourceId) || a.operationId.localeCompare(b.operationId));
  const requiredReversals: StripeMarketplaceSourceRefundPlan["requiredReversals"] = [];
  const debits = new Map(c.residual.allocation.sources.map(s => [s.sourceId, 0]));
  const netBefore = new Map(ordered.map(o => [o.operationId, o.request.amountCents - (state.reversed.get(o.operationId) ?? 0)]));
  const platformRelease = before.platformRemainingCents - after.platformRemainingCents;
  let merchantCredits = 0;
  for (const beneficiary of [...before.remainingBeneficiaries].sort((a, b) => a.merchantId.localeCompare(b.merchantId))) {
    const owned = ordered.filter(o => o.merchantId === beneficiary.merchantId);
    const sent = owned.reduce((sum, o) => sum + netBefore.get(o.operationId)!, 0);
    const held = [...beforeHeld.values()].reduce((sum, values) => sum + (values.get(beneficiary.merchantId) ?? 0), 0);
    const next = after.remainingBeneficiaries.find(b => b.merchantId === beneficiary.merchantId)!;
    const debit = current.allocation.merchantDebits.find(d => d.merchantId === beneficiary.merchantId)!.amountCents;
    if (!cents(sent) || !cents(held) || sent + held !== beneficiary.amountCents || !next || !cents(next.amountCents) ||
        beneficiary.amountCents - debit !== next.amountCents) fail();
    if (debit < 0) {
      merchantCredits -= debit;
      const original = state.held.get("original")!;
      original.set(beneficiary.merchantId, (original.get(beneficiary.merchantId) ?? 0) - debit);
      continue;
    }
    let needed = debit;
    for (const source of c.residual.allocation.sources) {
      const balances = state.held.get(source.sourceId)!, available = balances.get(beneficiary.merchantId) ?? 0;
      const amountCents = Math.min(needed, available);
      balances.set(beneficiary.merchantId, available - amountCents);
      debits.set(source.sourceId, debits.get(source.sourceId)! + amountCents); needed -= amountCents;
    }
    for (const o of owned) {
      const amountCents = Math.min(needed, netBefore.get(o.operationId)!);
      if (amountCents) {
        requiredReversals.push({ payoutId: o.operationId, sourceId: o.sourceId, merchantId: o.merchantId, amountCents });
        debits.set(o.sourceId, debits.get(o.sourceId)! + amountCents);
        state.reversed.set(o.operationId, (state.reversed.get(o.operationId) ?? 0) + amountCents); needed -= amountCents;
      }
    }
    if (needed) fail();
  }
  if (!cents(platformRelease) || platformRelease < merchantCredits) fail();
  debits.set("original", debits.get("original")! + platformRelease - merchantCredits);
  const sources = c.residual.allocation.sources.map((s, i) => {
    const netTransferredBeforeCents = ordered.filter(o => o.sourceId === s.sourceId)
      .reduce((sum, o) => sum + netBefore.get(o.operationId)!, 0);
    const reversalCents = requiredReversals.filter(r => r.sourceId === s.sourceId).reduce((sum, r) => sum + r.amountCents, 0);
    const refundDebitCents = debits.get(s.sourceId)!, refundedBeforeCents = state.refunded.get(s.sourceId)!;
    const refundedAfterCents = refundedBeforeCents + refundDebitCents;
    const platformBeforeCents = i ? 0 : before.platformRemainingCents, platformAfterCents = i ? 0 : after.platformRemainingCents;
    const heldBefore = beforeHeld.get(s.sourceId)!, heldAfter = state.held.get(s.sourceId)!;
    const availableBeforeCents = [...heldBefore.values()].reduce((sum, n) => sum + n, 0);
    const availableAfterCents = [...heldAfter.values()].reduce((sum, n) => sum + n, 0);
    const beneficiaryBalances = [...new Set([...heldBefore.keys(), ...heldAfter.keys()])].sort().map(merchantId => ({ merchantId,
      availableBeforeCents: heldBefore.get(merchantId) ?? 0, availableAfterCents: heldAfter.get(merchantId) ?? 0 }))
      .filter(b => b.availableBeforeCents || b.availableAfterCents);
    if (![netTransferredBeforeCents, reversalCents, refundDebitCents, availableBeforeCents, availableAfterCents].every(cents) ||
        reversalCents > netTransferredBeforeCents ||
        availableBeforeCents + reversalCents + platformBeforeCents - platformAfterCents !== refundDebitCents + availableAfterCents ||
        s.creditedNetCents !== refundedBeforeCents + platformBeforeCents + netTransferredBeforeCents + availableBeforeCents ||
        s.creditedNetCents !== refundedAfterCents + platformAfterCents + netTransferredBeforeCents - reversalCents + availableAfterCents) fail();
    state.refunded.set(s.sourceId, refundedAfterCents);
    return { sourceId: s.sourceId, chargeId: s.chargeId, creditedNetCents: s.creditedNetCents,
      refundedBeforeCents, refundDebitCents, refundedAfterCents,
      netTransferredBeforeCents, reversalCents, platformBeforeCents, platformAfterCents,
      availableBeforeCents, availableAfterCents, beneficiaryBalances };
  });
  if (sources.reduce((sum, s) => sum + s.refundDebitCents, 0) !== current.allocation.amountCents ||
      current.allocation.cumulativeRefundCents > c.basis.budget.capture.amountCents) fail();
  const raw = { version: 1 as const, kind: "stripe_v4_refund_sources" as const, contextHash: hash(c),
    refundPlanId: c.refundPlanId, amountCents: current.allocation.amountCents,
    cumulativeRefundCents: current.allocation.cumulativeRefundCents, sources, requiredReversals };
  return { ...raw, planHash: hash(raw) };
}

/** Complete sequential replay. Earlier requests are rebuilt against their own
 * immutable prefix; the latest refund cannot alter a prior source allowance. */
export function buildStripeMarketplaceSourceRefundPlan(c: StripeMarketplaceSourceRefundContext): StripeMarketplaceSourceRefundPlan {
  const count = validateBase(c), receiptIds = new Set<string>();
  const state: ReplayState = { reversed: new Map(),
    refunded: new Map(c.residual.allocation.sources.map(s => [s.sourceId, s.refundDebitCents])),
    held: new Map(c.residual.allocation.sources.map(s => [s.sourceId, new Map<string, number>()])) };
  for (const [i, h] of c.history.entries()) {
    const prefix: StripeMarketplaceSourceRefundContext = { ...c, basis: { ...c.basis, refunds: c.basis.refunds.slice(0, count + i + 1) },
      history: c.history.slice(0, i), refundPlanId: h.refundPlanId, returnId: h.returnId };
    const plan = step(prefix, count + i, state);
    if (h.planHash !== plan.planHash || !Array.isArray(h.reversals) || h.reversals.length !== plan.requiredReversals.length ||
        new Set(h.reversals.map(r => r.payoutId)).size !== h.reversals.length) fail();
    for (const r of h.reversals) {
      const expected = plan.requiredReversals.find(e => e.payoutId === r.payoutId);
      const request = expected && buildStripeMarketplaceSourceRefundRequest(prefix, plan, r.payoutId);
      if (!expected || !request || r.amountCents !== expected.amountCents || !/^trr_[A-Za-z0-9_]+$/.test(r.providerOperationId) ||
          receiptIds.has(r.providerOperationId) || r.reference !== request.reference || r.requestHash !== request.requestHash) fail();
      receiptIds.add(r.providerOperationId);
    }
  }
  return step(c, count + c.history.length, state);
}

export function buildStripeMarketplaceSourceRefundRequest(c: StripeMarketplaceSourceRefundContext,
  plan = buildStripeMarketplaceSourceRefundPlan(c), payoutId?: string): StripeMarketplaceSourceRefundRequest {
  if (plan.contextHash !== hash(c) || plan.refundPlanId !== c.refundPlanId) fail();
  const target = payoutId ? c.residual.operations.find(o => o.operationId === payoutId) : undefined;
  const reversal = payoutId ? plan.requiredReversals.find(r => r.payoutId === payoutId) : undefined;
  if (payoutId && (!target || !reversal)) fail();
  const capture = c.basis.budget.capture;
  const raw = { kind: target ? "transfer_reversal" as const : "refund" as const, provider: "stripe" as const,
    environment: capture.environment, accountFingerprint: capture.accountFingerprint,
    providerPaymentId: capture.providerPaymentId, sourceId: capture.sourceId, paymentAmountCents: capture.amountCents,
    amountCents: reversal?.amountCents ?? plan.amountCents, currency: "BRL" as const,
    previousRefunds: previousRefunds(c), reference: target ? `mreverse_${hash([c.basis.hostMerchantId, c.refundPlanId, payoutId])}` :
      `mrefund_${hash([c.basis.hostMerchantId, c.returnId])}`,
    stripeSourceFunding: { context: c, plan },
    ...(target ? { transfer: { kind: "residual" as const, requestHash: target.request.requestHash,
      providerTransferId: target.providerTransferId, destination: target.request.destination,
      amountCents: target.request.amountCents, reference: target.request.reference,
      ...(c.history.some(h => h.reversals.some(r => r.payoutId === payoutId)) ? {
        previousReversals: c.history.flatMap(h => h.reversals.filter(r => r.payoutId === payoutId)
          .map(({ providerOperationId, amountCents, reference, requestHash }) => ({ providerOperationId, amountCents, reference, requestHash }))) } : {}) } } : {}) };
  return { ...raw, requestHash: hash(raw) };
}
