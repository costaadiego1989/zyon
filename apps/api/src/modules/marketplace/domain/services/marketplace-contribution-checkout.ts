import type { MarketplaceContributionCheckoutRequest, MarketplaceContributionExcessRequest, MarketplaceContributionExcessObservation } from "../ports/marketplace-contribution-checkout.port.js";
import { buildMarketplaceRefundContributionCertificate, marketplaceContributionHash } from "./marketplace-refund-contribution.js";
import type { MarketplaceRefundContributionCertificate } from "../ports/marketplace-refund-contribution.port.js";
export const checkoutMetadata = (r: MarketplaceContributionCheckoutRequest) => ({ reason: r.reason, contributionId: r.contributionId,
  fundingPlanId: r.fundingPlanId, refundPlanId: r.refundPlanId, merchantId: r.merchantId, requestHash: r.requestHash, reference: r.reference });
/** Historical credit identity is checked independently of a transient journal
 * status. This grants no new PSP submission or excess-return permission. */
export function certifiedContributionCheckoutCredit(r:MarketplaceContributionCheckoutRequest,c:MarketplaceRefundContributionCertificate) {
  const rebuilt=buildMarketplaceRefundContributionCertificate(c.request,c.proof),q=c.request;
  return validContributionCheckout(r) && !!rebuilt && marketplaceContributionHash(rebuilt)===marketplaceContributionHash(c) &&
    q.collection?.journalId===r.contributionId && q.collection.requestHash===r.requestHash && q.collection.reference===r.reference &&
    q.contributionId===r.contributionId && q.fundingPlanId===r.fundingPlanId && q.hostMerchantId===r.hostMerchantId &&
    q.refundPlanId===r.refundPlanId && q.merchantId===r.merchantId && q.customerId===r.customerId &&
    q.accountFingerprint===r.accountFingerprint && q.environment===r.environment && q.grossAmountCents===r.grossAmountCents &&
    q.maximumCreditCents===r.maximumCreditCents && q.planHash===r.planHash && q.originalPaymentIntentId===r.originalPaymentIntentId &&
    q.originalChargeId===r.originalChargeId && q.authorisationId===`contribution-consent:${r.contributionId}:${r.actorUserId}`;
}
export function validContributionCheckout(r: MarketplaceContributionCheckoutRequest) {
  const { requestHash, ...raw } = r;
  return r.version === 1 && r.reason === "refund_processing_fee_contribution" && r.provider === "stripe" && r.method === "card" && r.currency === "BRL" &&
    ["test", "live"].includes(r.environment) && /^[a-f0-9]{64}$/.test(r.accountFingerprint) &&
    [r.contributionId,r.fundingPlanId,r.hostMerchantId,r.refundPlanId,r.merchantId,r.actorUserId].every(v=>typeof v==="string"&&!!v.trim()&&v.length<=200) &&
    /^cus_[A-Za-z0-9_]+$/.test(r.customerId) && /^pi_[A-Za-z0-9_]+$/.test(r.originalPaymentIntentId) && /^ch_[A-Za-z0-9_]+$/.test(r.originalChargeId) &&
    [r.grossAmountCents,r.maximumCreditCents,r.originalAmountCents].every(v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647) &&
    Number.isSafeInteger(r.originalRefundedAmountCents) && r.originalRefundedAmountCents>=0 && r.originalRefundedAmountCents<r.originalAmountCents &&
    Number.isFinite(Date.parse(r.authorisedAt)) && Number.isSafeInteger(r.expiresAt) && r.expiresAt*1000>Date.parse(r.authorisedAt) &&
    /^[a-f0-9]{64}$/.test(r.planHash) && /^mcollect_[a-f0-9]{64}$/.test(r.reference) && marketplaceContributionHash(raw)===requestHash;
}
export function validContributionExcess(r: MarketplaceContributionExcessRequest) {
  const { requestHash, ...raw } = r;
  const rebuilt = buildMarketplaceRefundContributionCertificate(r.certificate.request,r.certificate.proof);
  return !!rebuilt && marketplaceContributionHash(rebuilt)===marketplaceContributionHash(r.certificate) &&
    !!r.certificate.request.collection && Number.isSafeInteger(r.originalAmountCents) && r.originalAmountCents>0 && r.originalAmountCents<=2147483647 &&
    Number.isSafeInteger(r.amountCents) && r.amountCents>0 && r.amountCents===r.certificate.excessLiabilityCents &&
    r.contributionId===r.certificate.request.contributionId && r.merchantId===r.certificate.request.merchantId &&
    r.fundingPlanId===r.certificate.request.fundingPlanId && r.hostMerchantId===r.certificate.request.hostMerchantId &&
    r.environment===r.certificate.request.environment && r.accountFingerprint===r.certificate.request.accountFingerprint &&
    /^mexcess_[a-f0-9]{64}$/.test(r.reference) && marketplaceContributionHash(raw)===requestHash;
}
export const contributionExcessMetadata = (r: MarketplaceContributionExcessRequest) => ({ reason: "marketplace_contribution_excess_return",
  contributionId:r.contributionId,fundingPlanId:r.fundingPlanId,merchantId:r.merchantId,requestHash:r.requestHash,reference:r.reference });
/** Historic audit may disable recency; identity, account, amount and hash checks
 * remain mandatory. Live discharge requires a fresh independently read proof. */
export function validContributionExcessProof(r:MarketplaceContributionExcessRequest,o:MarketplaceContributionExcessObservation,requireFresh=true) {
  const p=o.proof as any,refund=p?.refund,balance=p?.balance;
  return validContributionExcess(r) && o.state==="confirmed" && o.amountCents===r.amountCents && !!p &&
    p.requestHash===r.requestHash && p.accountFingerprint===r.accountFingerprint && Number.isFinite(Date.parse(p.observedAt)) &&
    (!requireFresh || Date.parse(p.observedAt)>Date.now()-300000 && Date.parse(p.observedAt)<Date.now()+60000) &&
    /^re_[A-Za-z0-9_]+$/.test(o.providerRefundId ?? "") && refund?.object==="refund" && refund.id===o.providerRefundId &&
    refund.status==="succeeded" && refund.amount===r.amountCents && refund.charge===r.certificate.proof.charge.id &&
    refund.payment_intent===r.certificate.request.providerPaymentIntentId && refund.currency==="brl" &&
    marketplaceContributionHash(refund.metadata)===marketplaceContributionHash(contributionExcessMetadata(r)) &&
    /^txn_[A-Za-z0-9_]+$/.test(balance?.id ?? "") && balance.object==="balance_transaction" && balance.id===refund.balance_transaction &&
    balance.source===refund.id && balance.type==="refund" && balance.currency==="brl" && balance.amount===-r.amountCents &&
    balance.fee===0 && balance.net===-r.amountCents && balance.status==="available" && balance.exchange_rate===null &&
    Number.isSafeInteger(balance.available_on) && balance.available_on>0 && balance.available_on*1000<=Date.parse(p.observedAt)+60000;
}
