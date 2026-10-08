import type { FrozenMarketplaceFunding } from "./marketplace-funding-budget.js";
import { allocateMarketplaceProviderFee, MARKETPLACE_PROVIDER_FEE_POLICY } from "./marketplace-provider-fee-allocation.js";

export type UncapturedMarketplaceFunding = Omit<FrozenMarketplaceFunding, "provider"> & {
  provider: "stripe" | "asaas" | "mercadopago";
};

/** Validates the original agreement only. Produces no capture, budget or payout
 * evidence and never expands the providers permitted to create/fund a sale. */
export function assertMarketplaceUncapturedAllocation(input: UncapturedMarketplaceFunding): void {
  const cents = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw Error("marketplace_cancellation_allocation_invalid");
    return value;
  };
  if (!input.hostMerchantId?.trim() || input.feePolicy !== MARKETPLACE_PROVIDER_FEE_POLICY || input.currency !== "BRL" ||
      !["stripe", "asaas", "mercadopago"].includes(input.provider) || !["test", "live"].includes(input.environment) ||
      !input.accountFingerprint?.trim() || !input.lines.some(line => line.sellerMerchantId !== input.hostMerchantId)) {
    throw Error("marketplace_cancellation_allocation_invalid");
  }
  const participants = new Set([input.hostMerchantId, ...input.lines.map(line => line.sellerMerchantId)]);
  if (input.destinations.length !== participants.size || new Set(input.destinations.map(row => row.merchantId)).size !== participants.size ||
      new Set(input.destinations.map(row => row.destination)).size !== participants.size || input.destinations.some(row =>
        !participants.has(row.merchantId) || !row.destination?.trim() || input.provider === "stripe" && !row.destination.startsWith("acct_"))) {
    throw Error("marketplace_cancellation_allocation_invalid");
  }
  const receivables = new Map([...participants].map(merchantId => [merchantId, 0]));
  let charged = cents(input.buyerServiceFeeCents), retained = charged;
  // Reuses the seller/line/commission validation. Zero denotes no fee charged
  // in this arithmetic check, not a provider observation of money received.
  for (const line of allocateMarketplaceProviderFee(input.lines, 0)) {
    const net = line.sellerNetCents - cents(line.platformFeeCents);
    if (net <= 0 || line.sellerMerchantId === input.hostMerchantId && line.commissionCents !== 0) throw Error("marketplace_cancellation_allocation_invalid");
    receivables.set(line.sellerMerchantId, cents(receivables.get(line.sellerMerchantId)! + net));
    receivables.set(input.hostMerchantId, cents(receivables.get(input.hostMerchantId)! + line.commissionCents));
    charged = cents(charged + cents(line.grossAmountCents)); retained = cents(retained + line.platformFeeCents);
  }
  for (const shipping of input.shipping) {
    if (!participants.has(shipping.merchantId)) throw Error("marketplace_cancellation_allocation_invalid");
    charged = cents(charged + cents(shipping.amountCents));
    receivables.set(shipping.merchantId, cents(receivables.get(shipping.merchantId)! + shipping.amountCents));
  }
  const hostFee = cents(input.hostPlatformFeeCents ?? 0);
  const hostRemainder = receivables.get(input.hostMerchantId)! - hostFee;
  cents(hostRemainder); receivables.set(input.hostMerchantId, hostRemainder); retained = cents(retained + hostFee);
  if (charged !== cents(input.amountCents) || [...receivables.values()].reduce((sum, amount) => cents(sum + amount), retained) !== charged) {
    throw Error("marketplace_cancellation_allocation_invalid");
  }
}
