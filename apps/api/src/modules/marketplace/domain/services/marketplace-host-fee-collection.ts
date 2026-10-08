import type { MarketplaceHostFeeCollectionRequest, MarketplaceHostFeeCollectionObservation, MarketplaceHostFeeCredit, MarketplaceHostFeeIncomingProof } from "../ports/marketplace-host-fee-collection.port.js";
import { marketplaceContributionHash } from "./marketplace-refund-contribution.js";
import { allocateMarketplaceDisputeFee, assertMarketplaceDisputeClosureRequest } from "./marketplace-dispute-closure-evidence.js";
import { marketplaceHostPrincipalExtinctionId } from "./marketplace-order-dispute-closure.js";
import type { MarketplaceHostPrincipalExtinctionEvidence } from "../ports/marketplace-order-dispute-closure.port.js";
import type { MarketplaceHostDisputeObligationEvidence } from "../ports/marketplace-host-fee-collection.port.js";
import type { MarketplaceFeeExcessReturn } from "../ports/marketplace-fee-excess-return.port.js";
import { marketplaceFeeExcessReturnHashes } from "./marketplace-fee-excess-return.js";

const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const cents = (v: unknown, positive = false): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= (positive ? 1 : 0) && v <= 2147483647;
export function validHostFeeCollection(r: MarketplaceHostFeeCollectionRequest): boolean {
  try {
    const { requestHash, ...raw } = r, e = r.feeEvidence, d = r.disputeRequest;
    assertMarketplaceDisputeClosureRequest(d);
    const allocation = allocateMarketplaceDisputeFee(d, e.disputeFeeCents);
    return r.version === 1 && r.reason === "marketplace_host_dispute_fee_collection" && r.provider === "stripe" && r.method === "card" && r.currency === "BRL" &&
      ["test", "live"].includes(r.environment) && hash(r.accountFingerprint) && hash(r.feeCertificateHash) && hash(requestHash) &&
      [r.collectionId,r.debtId,r.feeCertificateId,r.hostMerchantId,r.fundingPlanId,r.merchantId,r.actorUserId].every(text) && /^cus_[A-Za-z0-9_]+$/.test(r.customerId) &&
      e.version === 1 && e.reason === "stripe_host_dispute_principal_extinguished" && e.feeCollectionState === "uncollected" &&
      e.fundingHoldReleased === false && e.payoutReauthorized === false && e.provider === r.provider && e.environment === r.environment && e.accountFingerprint === r.accountFingerprint &&
      e.payoutId === r.debtId && e.hostMerchantId === r.merchantId && r.hostMerchantId === r.merchantId && e.hostMerchantId === r.hostMerchantId && e.fundingPlanId === r.fundingPlanId &&
      e.requestHash === d.requestHash && e.providerDisputeId === d.providerDisputeId && e.providerPaymentId === d.providerPaymentId && e.sourceId === d.sourceId &&
      d.paymentIntentId === r.fundingPlanId && d.hostMerchantId === r.hostMerchantId && d.accountFingerprint === r.accountFingerprint && d.environment === r.environment &&
      e.instructionsHash === d.instructionsHash && e.budgetHash === d.budgetHash && hash(e.proofHash) &&
      r.feeCertificateId === marketplaceHostPrincipalExtinctionId(e) && r.feeCertificateHash === marketplaceContributionHash(e) &&
      cents(e.disputeFeeCents,true) && cents(e.hostDisputeFeeCents,true) && allocation.find(row => row.sellerMerchantId === r.merchantId)?.feeCents === e.hostDisputeFeeCents &&
      cents(r.grossAmountCents,true) && r.grossAmountCents >= 50 && cents(r.maximumCreditCents,true) && r.maximumCreditCents <= e.hostDisputeFeeCents &&
      Array.isArray(r.priorCreditHashes) && r.priorCreditHashes.length <= 2000 && r.priorCreditHashes.every(hash) && new Set(r.priorCreditHashes).size === r.priorCreditHashes.length &&
      Number.isFinite(Date.parse(r.authorisedAt)) && Number.isSafeInteger(r.expiresAt) && r.expiresAt * 1000 > Date.parse(r.authorisedAt) &&
      r.reference === `mhostfeecollect_${marketplaceContributionHash([r.feeCertificateId,r.collectionId,r.merchantId])}` && marketplaceContributionHash(raw) === requestHash;
  } catch { return false; }
}
export const hostFeeMetadata = (r: MarketplaceHostFeeCollectionRequest) => ({reason:r.reason,collectionId:r.collectionId,
  feeCertificateId:r.feeCertificateId,fundingPlanId:r.fundingPlanId,merchantId:r.merchantId,requestHash:r.requestHash,reference:r.reference});

export function hostFeeSessionObservation(r: MarketplaceHostFeeCollectionRequest, session: any, now = new Date()): MarketplaceHostFeeCollectionObservation {
  const id = (v: any) => typeof v === "string" ? v : v?.id;
  if (!validHostFeeCollection(r) || session?.object !== "checkout.session" || !/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(session.id ?? "") ||
    session.mode !== "payment" || session.livemode !== (r.environment === "live") || id(session.customer) !== r.customerId || session.currency !== "brl" ||
    session.amount_total !== r.grossAmountCents || session.amount_subtotal !== r.grossAmountCents || session.client_reference_id !== r.reference ||
    marketplaceContributionHash(session.metadata) !== marketplaceContributionHash(hostFeeMetadata(r)) ||
    session.payment_method_types?.length !== 1 || session.payment_method_types[0] !== "card" || session.subscription || session.setup_intent ||
    session.total_details?.amount_discount !== 0 || session.total_details?.amount_shipping !== 0 || session.total_details?.amount_tax !== 0 || session.expires_at !== r.expiresAt) return {state:"unknown"};
  const common = {sessionId:session.id,requestHash:r.requestHash,observedAt:now.toISOString(),session:structuredClone(session)};
  if (session.status === "complete" && session.payment_status === "paid" && /^pi_[A-Za-z0-9_]+$/.test(id(session.payment_intent) ?? "")) return {...common,state:"paid",paymentIntentId:id(session.payment_intent)};
  if (session.status === "expired" && session.payment_status === "unpaid" && !session.payment_intent) return {...common,state:"expired"};
  try { const u = new URL(session.url); if (session.status === "open" && session.payment_status === "unpaid" && !session.payment_intent && u.protocol === "https:" && u.hostname === "checkout.stripe.com" && !u.username && !u.password && !u.port) return {...common,state:"open",checkoutUrl:u.toString()}; } catch { /* Unknown retains the consumed claim. */ }
  return {state:"unknown"};
}

/** Credit comes from independently observed available net, never a Session POST.
 * Excess belongs to the paying host; it grants no refund budget or payout. */
export function buildHostFeeCredit(r: MarketplaceHostFeeCollectionRequest, p: MarketplaceHostFeeIncomingProof, now = new Date(), requireFresh = true): MarketplaceHostFeeCredit | undefined {
  try {
    const {paymentIntent:pi,charge:ch,balance:b}=p, time=Date.parse(p.observedAt);
    if (!validHostFeeCollection(r) || p.provider !== "stripe" || p.accountFingerprint !== r.accountFingerprint || p.requestHash !== r.requestHash ||
      !/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(p.sessionId) || !Number.isFinite(time) || time < Date.parse(r.authorisedAt) ||
      requireFresh && (time < now.getTime()-300000 || time > now.getTime()+60000) ||
      !/^pi_[A-Za-z0-9_]+$/.test(pi.id) || pi.id === r.disputeRequest.providerPaymentId || pi.status !== "succeeded" || pi.amountCents !== r.grossAmountCents || pi.receivedAmountCents !== r.grossAmountCents ||
      pi.customerId !== r.customerId || pi.currency !== "BRL" || pi.environment !== r.environment || pi.latestChargeId !== ch.id || pi.applicationFeeCents !== null || pi.onBehalfOf !== null || pi.transferDestination !== null ||
      marketplaceContributionHash(pi.metadata) !== marketplaceContributionHash(hostFeeMetadata(r)) ||
      !/^ch_[A-Za-z0-9_]+$/.test(ch.id) || ch.id === r.disputeRequest.sourceId || ch.paymentIntentId !== pi.id || ch.customerId !== r.customerId || ch.amountCents !== r.grossAmountCents ||
      ch.status !== "succeeded" || ch.paymentMethodType !== "card" || ch.currency !== "BRL" || ch.environment !== r.environment || ch.paid !== true || ch.captured !== true || ch.disputed !== false ||
      ch.refundedAmountCents !== 0 || ch.refundsComplete !== true || !Array.isArray(ch.refundIds) || ch.refundIds.length || ch.transferId !== null || ch.applicationFeeCents !== null || ch.balanceTransactionId !== b.id ||
      !/^txn_[A-Za-z0-9_]+$/.test(b.id) || b.id === r.disputeRequest.captureBalanceTransactionId || b.sourceId !== ch.id || b.type !== "charge" || b.status !== "available" || b.currency !== "BRL" ||
      b.amountCents !== r.grossAmountCents || !cents(b.feeCents) || !cents(b.netCents,true) || b.amountCents-b.feeCents !== b.netCents) return undefined;
    const raw = {version:1 as const,reason:"marketplace_host_dispute_fee_credit" as const,request:structuredClone(r),proof:structuredClone(p),
      creditCents:Math.min(b.netCents,r.maximumCreditCents),processingFeeCents:b.feeCents,excessLiabilityCents:Math.max(0,b.netCents-r.maximumCreditCents)};
    return {...raw,certificateHash:marketplaceContributionHash(raw)};
  } catch { return undefined; }
}

/** The repository separately proves the persisted host principal certificate and
 * every credit/event. Native source fee debits do not count as host payment. */
export function buildMarketplaceHostDisputeObligation(e: MarketplaceHostPrincipalExtinctionEvidence,
  feeCertificateId: string, feeCertificateHash: string, credits: MarketplaceHostFeeCredit[], returns: MarketplaceFeeExcessReturn[] = []): MarketplaceHostDisputeObligationEvidence | undefined {
  try {
    if (e.version !== 1 || e.reason !== "stripe_host_dispute_principal_extinguished" || e.feeCollectionState !== "uncollected" ||
        e.fundingHoldReleased !== false || e.payoutReauthorized !== false || !cents(e.amountCents,true) || !cents(e.hostDisputeFeeCents,true) ||
        feeCertificateId !== marketplaceHostPrincipalExtinctionId(e) || feeCertificateHash !== marketplaceContributionHash(e) ||
        !Array.isArray(credits) || !credits.length || credits.length>2000) return;
    const hashes: string[] = [], collections = new Set<string>(), receipts = new Set<string>();
    let collected = 0, processing = 0;
    const originalRequest = credits[0]!.request.disputeRequest;
    for (const credit of credits) {
      const r = credit.request;
      if (!validHostFeeCollection(r) || r.feeCertificateId !== feeCertificateId || r.feeCertificateHash !== feeCertificateHash ||
          marketplaceContributionHash(r.feeEvidence) !== marketplaceContributionHash(e) ||
          marketplaceContributionHash(r.disputeRequest) !== marketplaceContributionHash(originalRequest) ||
          marketplaceContributionHash(r.priorCreditHashes) !== marketplaceContributionHash(hashes) ||
          r.maximumCreditCents !== e.hostDisputeFeeCents-collected || collections.has(r.collectionId)) return;
      const rebuilt = buildHostFeeCredit(r,credit.proof,new Date(credit.proof.observedAt),false);
      if (!rebuilt || marketplaceContributionHash(rebuilt)!==marketplaceContributionHash(credit) || !cents(credit.creditCents,true)) return;
      for (const receipt of [credit.proof.sessionId,credit.proof.paymentIntent.id,credit.proof.charge.id,credit.proof.balance.id]) {
        if (receipts.has(receipt)) return; receipts.add(receipt);
      }
      collections.add(r.collectionId); hashes.push(credit.certificateHash); collected+=credit.creditCents; processing+=credit.processingFeeCents;
      if (!cents(collected) || collected>e.hostDisputeFeeCents || !cents(processing)) return;
    }
    if (collected!==e.hostDisputeFeeCents) return;
    const returnHashes = marketplaceFeeExcessReturnHashes("host", credits, returns);
    if (!returnHashes) return;
    return {version:1,reason:"stripe_host_dispute_obligation_closed",debtId:e.payoutId,payoutId:e.payoutId,feeCertificateId,feeCertificateHash,
      hostMerchantId:e.hostMerchantId,fundingPlanId:e.fundingPlanId,providerDisputeId:e.providerDisputeId,closureSnapshotId:e.closureSnapshotId,
      provider:"stripe",environment:e.environment,accountFingerprint:e.accountFingerprint,principalAmountCents:e.amountCents,
      disputeFeeCents:e.hostDisputeFeeCents,collectedFeeCents:collected,processingFeeCents:processing,excessLiabilityCents:0,
      creditHashes:hashes,...(returnHashes.length ? {excessReturnHashes:returnHashes} : {}),fundingHoldReleased:false,payoutReauthorized:false};
  } catch { return; }
}
export function marketplaceHostDisputeObligationId(e: Pick<MarketplaceHostDisputeObligationEvidence,"hostMerchantId"|"fundingPlanId"|"payoutId">) {
  return `mhost_obligation_${marketplaceContributionHash([e.hostMerchantId,e.fundingPlanId,e.payoutId])}`;
}
export function marketplaceHostDisputeObligationPayload(e: MarketplaceHostDisputeObligationEvidence) {
  return {obligation_id:marketplaceHostDisputeObligationId(e),debt_id:e.payoutId,payout_id:e.payoutId,fee_certificate_id:e.feeCertificateId,
    funding_plan_id:e.fundingPlanId,host_merchant_id:e.hostMerchantId,evidence_hash:marketplaceContributionHash(e),
    principal_amount_cents:e.principalAmountCents,dispute_fee_cents:e.disputeFeeCents,collected_fee_cents:e.collectedFeeCents,
    processing_fee_cents:e.processingFeeCents,excess_liability_cents:0,funding_hold_released:false,payout_reauthorized:false,
    ...(e.excessReturnHashes?.length ? {excess_return_hashes:e.excessReturnHashes} : {})};
}
