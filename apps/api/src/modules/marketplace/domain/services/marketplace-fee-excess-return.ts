import type { MarketplaceFeeExcessRequest, MarketplaceFeeExcessObservation, MarketplaceFeeExcessReturn } from "../ports/marketplace-fee-excess-return.port.js";
import type { MarketplaceSellerFeeCredit } from "../ports/marketplace-seller-fee-collection.port.js";
import type { MarketplaceHostFeeCredit } from "../ports/marketplace-host-fee-collection.port.js";
import { buildSellerFeeCredit } from "./marketplace-seller-fee-collection.js";
import { buildHostFeeCredit } from "./marketplace-host-fee-collection.js";
import { marketplaceContributionHash as hash } from "./marketplace-refund-contribution.js";

type Credit = MarketplaceSellerFeeCredit | MarketplaceHostFeeCredit;
export function marketplaceFeeExcessReference(family: MarketplaceFeeExcessRequest["family"], credit: Credit): string {
  return `mfee_excess_${hash([family, credit.request.collectionId, credit.certificateHash, credit.excessLiabilityCents])}`;
}
export function validMarketplaceFeeExcessRequest(r: MarketplaceFeeExcessRequest): boolean {
  try {
    const { requestHash, ...raw } = r, c = r.credit;
    const rebuilt = r.family === "seller" && c.reason === "marketplace_seller_dispute_fee_credit"
      ? buildSellerFeeCredit(c.request, c.proof, new Date(c.proof.observedAt), false)
      : r.family === "host" && c.reason === "marketplace_host_dispute_fee_credit"
        ? buildHostFeeCredit(c.request, c.proof, new Date(c.proof.observedAt), false) : undefined;
    return !!rebuilt && hash(rebuilt) === hash(c) && Number.isSafeInteger(r.amountCents) && r.amountCents > 0 &&
      r.amountCents === c.excessLiabilityCents && /^[A-Za-z0-9_-]{1,200}$/.test(r.actorUserId) &&
      Number.isFinite(Date.parse(r.authorisedAt)) && Date.parse(r.authorisedAt) >= Date.parse(c.proof.observedAt) &&
      r.reference === marketplaceFeeExcessReference(r.family, c) && /^[a-f0-9]{64}$/.test(requestHash) && hash(raw) === requestHash;
  } catch { return false; }
}
export const marketplaceFeeExcessMetadata = (r: MarketplaceFeeExcessRequest) => ({
  reason: "marketplace_fee_excess_return", family: r.family, collectionId: r.credit.request.collectionId,
  feeCertificateId: r.credit.request.feeCertificateId, fundingPlanId: r.credit.request.fundingPlanId,
  merchantId: r.credit.request.merchantId, creditHash: r.credit.certificateHash,
  requestHash: r.requestHash, reference: r.reference,
});

/** Live discharge requires a fresh independent GET proof. Historical rebuilding
 * disables only recency; the account, amount, original receipt and hash stay bound. */
export function buildMarketplaceFeeExcessReturn(r: MarketplaceFeeExcessRequest, o: MarketplaceFeeExcessObservation,
  now = new Date(), requireFresh = true): MarketplaceFeeExcessReturn | undefined {
  try {
    const p = o.proof, f = p?.refund, b = p?.balance, c = r.credit, time = Date.parse(p?.observedAt ?? "");
    if (!validMarketplaceFeeExcessRequest(r) || o.state !== "confirmed" || !p || !f || !b ||
      p.requestHash !== r.requestHash || p.accountFingerprint !== c.request.accountFingerprint || !Number.isFinite(time) ||
      time < Date.parse(r.authorisedAt) || requireFresh && (time < now.getTime() - 300_000 || time > now.getTime() + 60_000) ||
      !/^re_[A-Za-z0-9_]+$/.test(o.providerRefundId ?? "") || f.object !== "refund" || f.id !== o.providerRefundId ||
      f.status !== "succeeded" || f.amount !== r.amountCents || f.currency !== "brl" || !Number.isSafeInteger(f.created) || f.created <= 0 ||
      f.created < Math.floor(Date.parse(r.authorisedAt) / 1000) || f.created * 1000 > time + 60_000 ||
      f.charge !== c.proof.charge.id || f.payment_intent !== c.proof.paymentIntent.id ||
      hash(f.metadata) !== hash(marketplaceFeeExcessMetadata(r)) || !/^txn_[A-Za-z0-9_]+$/.test(b.id) ||
      b.id === c.proof.balance.id || b.id === c.request.disputeRequest.captureBalanceTransactionId ||
      b.object !== "balance_transaction" || b.id !== f.balance_transaction || b.source !== f.id || b.type !== "refund" ||
      b.status !== "available" || b.currency !== "brl" || b.amount !== -r.amountCents || b.fee !== 0 || b.net !== -r.amountCents ||
      b.exchange_rate !== null || !Number.isSafeInteger(b.available_on) || b.available_on <= 0 || b.available_on * 1000 > time + 60_000) return;
    const raw = { request: structuredClone(r), proof: structuredClone(p) };
    return { ...raw, certificateHash: hash(raw) };
  } catch { return; }
}

/** Exactly one certified return per nonzero original excess, in credit order. */
export function marketplaceFeeExcessReturnHashes(family: MarketplaceFeeExcessRequest["family"], credits: Credit[],
  returns: MarketplaceFeeExcessReturn[]): string[] | undefined {
  try {
    if (!Array.isArray(returns) || returns.length > credits.length) return;
    const used = new Set<MarketplaceFeeExcessReturn>(), receipts = new Set(credits.flatMap(c =>
      [c.proof.sessionId, c.proof.paymentIntent.id, c.proof.charge.id, c.proof.balance.id])), hashes: string[] = [];
    for (const credit of credits) {
      if (!credit.excessLiabilityCents) continue;
      const matches = returns.filter(r => r.request.family === family && hash(r.request.credit) === hash(credit));
      if (matches.length !== 1) return;
      const returned = matches[0]!, rebuilt = buildMarketplaceFeeExcessReturn(returned.request,
        { state: "confirmed", providerRefundId: returned.proof.refund.id, proof: returned.proof }, new Date(returned.proof.observedAt), false);
      if (!rebuilt || hash(rebuilt) !== hash(returned) || used.has(returned) ||
          receipts.has(returned.proof.refund.id) || receipts.has(returned.proof.balance.id) || hashes.includes(returned.certificateHash)) return;
      used.add(returned); receipts.add(returned.proof.refund.id); receipts.add(returned.proof.balance.id); hashes.push(returned.certificateHash);
    }
    return used.size === returns.length ? hashes : undefined;
  } catch { return; }
}
