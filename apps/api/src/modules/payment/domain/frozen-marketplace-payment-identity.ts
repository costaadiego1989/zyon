import { createHash } from "node:crypto";
import type { MarketplaceFundingPlan } from "@prisma/client";
import { fundingHash } from "../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { buildMarketplaceFundingBudget } from "../../marketplace/domain/services/marketplace-funding-budget.js";
import { assertRecordedMarketplacePublicPayment } from "../application/marketplace-public-payment-admission.service.js";
import { assertPaymentAmount } from "./payment-amount.js";
import type { PaymentIntentSnapshot } from "./payment-intent.entity.js";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const statuses = new Set(["pending", "requires_action", "approved", "failed", "cancelled", "refunded",
  "chargeback_pending", "chargeback_disputed", "chargeback_lost", "chargeback_won"]);

/** Shared frozen allocation proof; never reads current catalog, routing or shipping quotes. */
export function assertFrozenMarketplacePaymentIdentity(snapshot: PaymentIntentSnapshot, plan: MarketplaceFundingPlan, cartRef: string): void {
  const input = snapshot.creation?.input, funding = input?.marketplaceFunding;
  if (!input || !record(input) || !funding || !record(funding) || !record(plan.instructions) ||
    !snapshot.creation || !["ready", "in_flight", "uncertain", "complete"].includes(snapshot.creation.state) ||
    !statuses.has(snapshot.status) || !nonempty(snapshot.id) || !nonempty(snapshot.idempotencyKey) ||
    plan.paymentIntentId !== snapshot.id || plan.hostMerchantId !== snapshot.merchantId || plan.checkoutSessionId !== cartRef ||
    input.intentId !== snapshot.id || input.merchantId !== snapshot.merchantId || input.sessionId !== snapshot.sessionId ||
    input.method !== snapshot.method || !["card", "pix", "boleto"].includes(snapshot.method) ||
    input.amountCents !== snapshot.amountCents || input.currency !== snapshot.currency || snapshot.currency !== "BRL" ||
    input.provider !== plan.provider || funding.provider !== plan.provider || funding.environment !== plan.environment ||
    funding.hostMerchantId !== snapshot.merchantId || funding.amountCents !== snapshot.amountCents || funding.currency !== snapshot.currency ||
    plan.amountCents !== snapshot.amountCents || funding.accountFingerprint !== plan.accountFingerprint ||
    input.providerAccountFingerprint !== plan.accountFingerprint || !/^[a-f0-9]{64}$/i.test(plan.accountFingerprint) ||
    fundingHash(plan.instructions) !== plan.instructionsHash || fundingHash(funding) !== plan.instructionsHash ||
    input.providerIdempotencyKey !== createHash("sha256").update(`${snapshot.merchantId}\0${snapshot.sessionId}\0${snapshot.idempotencyKey}`).digest("hex") ||
    input.settlementMode || input.stripeConnectAccountId || input.merchantPayoutDestination || (input.platformFeeCents ?? 0) !== 0 ||
    input.merchantPayoutHoldDays !== undefined || input.creditCard || input.creditCardHolderInfo || input.remoteIp ||
    (funding.provider === "stripe" ? snapshot.method !== "card" : !nonempty(input.asaasCustomerId)) ||
    plan.providerPaymentId !== null && plan.providerPaymentId !== snapshot.providerPaymentId ||
    snapshot.providerPaymentId !== undefined && !nonempty(snapshot.providerPaymentId) ||
    !["pending", "failed", "cancelled"].includes(snapshot.status) && !nonempty(snapshot.providerPaymentId) ||
    snapshot.status === "approved" && snapshot.approvedAmountCents !== snapshot.amountCents || !snapshot.amountBreakdown) {
    throw new Error("invalid_frozen_identity");
  }
  assertPaymentAmount(snapshot.amountBreakdown, snapshot.amountCents, snapshot.currency);
  buildMarketplaceFundingBudget(funding, { ...funding, providerPaymentId: "validation", sourceId: "validation",
    providerFeeCents: 0, netAmountCents: funding.amountCents });
  // The completion proof excludes the buyer fee. Its persisted breakdown must
  // agree with the frozen allocation, not merely add up to the same grand total.
  if (snapshot.amountBreakdown.discountCents !== 0 || snapshot.amountBreakdown.platformFeeCents !== funding.buyerServiceFeeCents ||
    snapshot.amountBreakdown.itemsSubtotalCents !== funding.lines.reduce((sum, line) => sum + line.grossAmountCents, 0) ||
    snapshot.amountBreakdown.shippingCents !== funding.shipping.reduce((sum, row) => sum + row.amountCents, 0)) {
    throw new Error("invalid_frozen_amount_breakdown");
  }
  if (input.marketplacePublicAdmission !== undefined) assertRecordedMarketplacePublicPayment(input);
}
