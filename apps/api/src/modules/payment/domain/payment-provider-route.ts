import type { CreateProviderPaymentInput, MarketplaceCaptureAccount } from "./ports/payment-provider.port.js";

/** Reconciliation always follows the persisted creation, never current settings. */
export function paymentProviderRoute(input: CreateProviderPaymentInput | undefined) {
  const funding = input?.marketplaceFunding;
  const marketplaceAccount: MarketplaceCaptureAccount | undefined = funding ? {
    provider: funding.provider, environment: funding.environment, accountFingerprint: funding.accountFingerprint,
  } : undefined;
  return { provider: input?.provider, providerAccountFingerprint: input?.providerAccountFingerprint,
    settlementMode: input?.settlementMode,
    ...(input?.stripeConnectAccountId ? { stripeConnectAccountId: input.stripeConnectAccountId } : {}),
    ...(input?.stripeChargeMode ? { stripeChargeMode: input.stripeChargeMode } : {}),
    ...(marketplaceAccount ? { marketplaceAccount } : {}) };
}
