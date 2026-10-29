import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { lockCheckoutSessionAnchor } from "../../../../shared/persistence/checkout-session-lock.js";
import { parseWidgetCheckoutPaymentAuthority } from "../../../payment/domain/widget-checkout-payment-authority.schemas.js";
import { readPaymentWidgetCheckoutAuthority } from "../../../payment/domain/payment-widget-checkout-authority.js";
import { assertNoPaymentCouponAuthorityInProviderInput } from "../../../payment/domain/payment-coupon-authority.js";

const conflict = (): never => { throw new Error("payment_widget_checkout_authority_conflict"); };
const providerReference = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));

/** Caller MUST own this same transaction through completed-order/quota/outbox
 * writes. A detached parsed sibling or a finished read transaction grants no
 * authority. Historical paid amounts never consult current catalog/contact. */
export async function assertWidgetPaymentOrderInTransaction(tx: Prisma.TransactionClient, merchantId: string, sessionId: string,
  expected: unknown, paymentIntentId: string, providerPaymentId: string): Promise<void> {
  const frozen = parseWidgetCheckoutPaymentAuthority(expected);
  if (!providerReference.safeParse(providerPaymentId).success || frozen.merchantId !== merchantId || frozen.checkoutSessionId !== sessionId
    || frozen.paymentId !== paymentIntentId) return conflict();
  await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
  await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
  await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${merchantId} AND session_id=${sessionId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM payment_intents WHERE id=${paymentIntentId} AND merchant_id=${merchantId} AND session_id=${sessionId} FOR UPDATE`;
  const row = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId, sessionId }, select: {
    id: true, merchantId: true, sessionId: true, version: true, status: true, amountCents: true, approvedAmountCents: true,
    providerPaymentId: true, currency: true, method: true, amountBreakdown: true, creation: true, acceptedOfferId: true,
  } });
  if (row) assertNoPaymentCouponAuthorityInProviderInput((row.creation as { input?: unknown } | null)?.input);
  if (!row || row.id !== paymentIntentId || row.merchantId !== merchantId || row.sessionId !== sessionId
    || row.status !== "approved" || row.providerPaymentId !== providerPaymentId || row.acceptedOfferId !== null
    || !Number.isSafeInteger(row.version) || row.version < 1 || row.amountCents !== frozen.amountCents
    || row.approvedAmountCents !== row.amountCents || row.currency !== frozen.currency
    || row.creation && typeof row.creation === "object" && "couponAuthority" in row.creation
    || !isDeepStrictEqual(readPaymentWidgetCheckoutAuthority(row), frozen)) return conflict();
}
