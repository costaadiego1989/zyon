import { fundingHash } from "../../infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { allocateMarketplaceProviderFee } from "./marketplace-provider-fee-allocation.js";
import type { MarketplaceDisputeClosureProof, MarketplaceDisputeClosureRequest, MarketplaceDisputeFeeLiability } from "../ports/marketplace-dispute-closure.port.js";

const cents = (amount: number) => Number.isSafeInteger(amount) && Math.abs(amount) <= 2_147_483_647;
const fail = (): never => { throw Error("marketplace_dispute_closure_evidence_invalid"); };
export function assertMarketplaceDisputeClosureRequest(input: MarketplaceDisputeClosureRequest): void {
  const { requestHash, ...body } = input;
  if (input.version !== 1 || input.provider !== "stripe" || !["test", "live"].includes(input.environment) ||
      !input.hostMerchantId?.trim() || !input.paymentIntentId?.trim() || !input.checkoutSessionId?.trim() ||
      !/^[a-f0-9]{64}$/.test(input.instructionsHash) || !/^[a-f0-9]{64}$/.test(input.budgetHash) ||
      !/^[a-f0-9]{64}$/.test(input.accountFingerprint) || !/^pi_[A-Za-z0-9_]+$/.test(input.providerPaymentId) ||
      !/^ch_[A-Za-z0-9_]+$/.test(input.sourceId) || !/^txn_[A-Za-z0-9_]+$/.test(input.captureBalanceTransactionId) ||
      !/^(dp|du)_[A-Za-z0-9_]+$/.test(input.providerDisputeId) || input.currency !== "BRL" ||
      !cents(input.amountCents) || input.amountCents <= 0 || !cents(input.captureFeeCents) || input.captureFeeCents < 0 ||
      !cents(input.captureNetCents) || input.captureNetCents <= 0 || input.captureFeeCents + input.captureNetCents !== input.amountCents ||
      input.feePolicy !== "proportional_seller_sales_v1" || !Array.isArray(input.sales) || !input.sales.length || input.sales.length > 2000 ||
      !/^[a-f0-9]{64}$/.test(requestHash) || fundingHash(body) !== requestHash) fail();
  allocateMarketplaceProviderFee(input.sales, 0);
  if (input.sales.reduce((sum, line) => sum + line.grossAmountCents, 0) > input.amountCents) fail();
}

export function assertMarketplaceDisputeClosureProof(request: MarketplaceDisputeClosureRequest, proof: MarketplaceDisputeClosureProof, now = new Date()): void {
  assertMarketplaceDisputeClosureRequest(request);
  const observed = Date.parse(proof.observedAt);
  if (proof.version !== 1 || proof.provider !== request.provider || proof.environment !== request.environment ||
      proof.accountFingerprint !== request.accountFingerprint || proof.providerPaymentId !== request.providerPaymentId ||
      proof.sourceId !== request.sourceId || proof.providerDisputeId !== request.providerDisputeId || proof.requestHash !== request.requestHash ||
      proof.amountCents !== request.amountCents || proof.currency !== "BRL" || !["won", "lost"].includes(proof.status) ||
      !Number.isFinite(observed) || observed < now.getTime() - 300_000 || observed > now.getTime() + 60_000 ||
      !Array.isArray(proof.entries) || proof.entries.length !== (proof.status === "won" ? 2 : 1) ||
      new Set(proof.entries.map(entry => entry.balanceTransactionId)).size !== proof.entries.length) fail();
  let withdrawn = 0, reinstated = 0, fees = 0, balance = 0;
  for (const entry of proof.entries) {
    if (!/^txn_[A-Za-z0-9_]+$/.test(entry.balanceTransactionId) || !cents(entry.amountCents) || !cents(entry.feeCents) ||
        !cents(entry.netCents) || entry.amountCents - entry.feeCents !== entry.netCents || !Number.isSafeInteger(entry.created) ||
        entry.created <= 0 || entry.created * 1000 > observed + 60_000 || !Number.isSafeInteger(entry.availableOn) ||
        entry.availableOn <= 0 || entry.availableOn * 1000 > observed + 60_000) fail();
    if (entry.kind === "principal_withdrawal" && entry.amountCents === -request.amountCents && entry.feeCents >= 0) withdrawn += -entry.amountCents;
    else if (entry.kind === "principal_reinstatement" && entry.amountCents === request.amountCents && entry.feeCents <= 0) reinstated += entry.amountCents;
    else fail();
    fees += entry.feeCents; balance += entry.netCents;
  }
  if (withdrawn !== request.amountCents || reinstated !== (proof.status === "won" ? request.amountCents : 0) ||
      !cents(fees) || fees < 0 || !cents(balance) || proof.principalWithdrawnCents !== withdrawn ||
      proof.principalReinstatedCents !== reinstated || proof.providerFeeCents !== fees || proof.balanceDeltaCents !== balance ||
      balance !== reinstated - withdrawn - fees) fail();
}

/** Separate liabilities may exceed the available receivable. Never cap a fee,
 * shift it to another seller, or pretend an uncollected fee is already paid. */
export function allocateMarketplaceDisputeFee(request: MarketplaceDisputeClosureRequest, feeCents: number): MarketplaceDisputeFeeLiability[] {
  assertMarketplaceDisputeClosureRequest(request);
  if (!cents(feeCents) || feeCents < 0) fail();
  const sales = new Map<string, number>();
  for (const line of request.sales) sales.set(line.sellerMerchantId, (sales.get(line.sellerMerchantId) ?? 0) + line.grossAmountCents);
  const total = [...sales.values()].reduce((sum, value) => sum + BigInt(value), 0n);
  const rows = [...sales].map(([sellerMerchantId, salesCents]) => {
    const weight = BigInt(feeCents) * BigInt(salesCents);
    return { sellerMerchantId, salesCents, feeCents: Number(weight / total), remainder: weight % total };
  });
  const remaining = feeCents - rows.reduce((sum, row) => sum + row.feeCents, 0);
  rows.sort((a, b) => a.remainder === b.remainder ? (a.sellerMerchantId < b.sellerMerchantId ? -1 : a.sellerMerchantId > b.sellerMerchantId ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index++) rows[index]!.feeCents++;
  return rows.sort((a, b) => a.sellerMerchantId < b.sellerMerchantId ? -1 : a.sellerMerchantId > b.sellerMerchantId ? 1 : 0)
    .map(({ remainder: _remainder, ...row }) => ({ ...row, collectionState: "uncollected" }));
}

/** Freshness is transport provenance, not ledger identity. Identical movements
 * observed later replay the same snapshot; a late win appends only its credit. */
export function marketplaceDisputeClosureProofHash(proof: MarketplaceDisputeClosureProof): string {
  const { observedAt: _observed, ...body } = proof;
  return fundingHash({ ...body, entries: [...proof.entries].sort((a, b) => a.balanceTransactionId < b.balanceTransactionId ? -1 : a.balanceTransactionId > b.balanceTransactionId ? 1 : 0) });
}
