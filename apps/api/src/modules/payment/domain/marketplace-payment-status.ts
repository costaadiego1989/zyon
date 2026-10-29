import type { PaymentIntentSnapshot } from './payment-intent.entity.js';
import type { FetchPaymentStatusInput } from './ports/payment-provider.port.js';

/** Builds a read request from the immutable admitted charge, never from buyer/provider metadata. */
export function marketplacePaymentStatusInput(snapshot: PaymentIntentSnapshot): FetchPaymentStatusInput | null {
  const input = snapshot.creation?.input;
  if (input?.marketplaceFunding === undefined) return null;
  const funding = input.marketplaceFunding;
  if (!funding || !['stripe', 'asaas'].includes(funding.provider) || !['test', 'live'].includes(funding.environment) ||
      typeof funding.accountFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(funding.accountFingerprint) ||
      !snapshot.providerPaymentId?.trim() || !snapshot.id?.trim() || !snapshot.merchantId?.trim() || !snapshot.sessionId?.trim() ||
      input.provider !== funding.provider || input.providerAccountFingerprint !== funding.accountFingerprint ||
      funding.hostMerchantId !== snapshot.merchantId || input.merchantId !== snapshot.merchantId ||
      input.sessionId !== snapshot.sessionId || input.intentId !== snapshot.id || input.method !== snapshot.method ||
      !Number.isSafeInteger(snapshot.amountCents) || snapshot.amountCents <= 0 || snapshot.currency !== 'BRL' ||
      input.amountCents !== snapshot.amountCents || funding.amountCents !== snapshot.amountCents ||
      input.currency !== snapshot.currency || funding.currency !== snapshot.currency ||
      input.settlementMode || input.stripeConnectAccountId || input.merchantPayoutDestination ||
      input.merchantPayoutHoldDays !== undefined || (input.platformFeeCents ?? 0) !== 0 || input.creditCard || input.creditCardHolderInfo ||
      (funding.provider === 'stripe' ? snapshot.method !== 'card' :
        !['pix', 'boleto', 'card'].includes(snapshot.method) || !input.asaasCustomerId?.trim())) {
    throw new Error('marketplace_payment_identity_invalid');
  }
  return {
    merchantId: snapshot.merchantId,
    providerPaymentId: snapshot.providerPaymentId,
    provider: funding.provider,
    providerAccountFingerprint: funding.accountFingerprint,
    marketplaceAccount: { provider: funding.provider, environment: funding.environment, accountFingerprint: funding.accountFingerprint },
    marketplacePayment: { intentId: snapshot.id, sessionId: snapshot.sessionId, amountCents: snapshot.amountCents,
      currency: snapshot.currency, method: snapshot.method,
      ...(funding.provider === 'asaas' ? { asaasCustomerId: input.asaasCustomerId } : {}) },
  };
}
