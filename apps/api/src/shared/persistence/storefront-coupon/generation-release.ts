import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { CheckoutEditSection } from "@zyon/shared-types";
import { parseCheckoutCouponPaymentAuthority, type CheckoutCouponBinding } from "../../../modules/checkout/domain/services/checkout-coupon-binding.js";
import { readStoredCheckoutCouponBinding, stripStoredCheckoutCouponBinding } from "../../../modules/checkout/domain/services/checkout-coupon-storage.js";
import { assertBoundCouponReleasePaymentsResolved } from "../../../modules/checkout/domain/services/bound-coupon-release-proof.js";
import { reopenCheckout } from "../../../modules/checkout/domain/services/reopen-checkout.js";
import { paymentCartFingerprint } from "../../../modules/checkout/domain/services/payment-cart-fingerprint.js";
import { toCheckoutSession } from "../../../modules/checkout/infrastructure/prisma/checkout-session.mapper.js";
import { lockStorefrontCart } from "../storefront-cart-lock.js";
import { appendOutboxInTransaction } from "../../messaging/infrastructure/append-outbox-in-transaction.js";
import { createCheckoutEventEnvelope } from "../../../modules/checkout/domain/events/checkout-domain-event.js";
import type { StorefrontCouponCheckoutCandidate } from "./contracts.js";
import { cancelUnboundStorefrontCouponReservation } from "./reservation-cancellation.js";
import { assertCapturedStorefrontCouponSourceProjection } from "./source-projection-basis.js";

type Row = Parameters<typeof toCheckoutSession>[0] & { id: string; version: number };
const reference = z.string().min(1).max(191);
const receiptSchema = z.object({ eventId: reference, merchantId: reference, eventType: z.literal("checkout.cart.updated"),
  schemaVersion: z.literal(1), producer: z.literal("checkout"), payload: z.strictObject({
    session_id: reference, currency: z.literal("BRL"), total: z.number().finite().nonnegative(), item_count: z.number().int().nonnegative(),
    coupon_release: z.strictObject({ version: z.literal(1), authority: z.unknown() }),
  }) });
const paymentSelect = { id: true, merchantId: true, sessionId: true, amountCents: true, currency: true, method: true,
  status: true, providerPaymentId: true, approvedAmountCents: true, creation: true } as const;
const linesSchema = z.array(z.object({ variantId: reference, productId: reference, sku: reference,
  quantity: z.number().int().positive(), unitPriceCents: z.number().int().nonnegative(),
  selectedOptions: z.array(z.object({ itemId: reference })).optional() })).min(1).max(100);
function sourceItemsForCas(items: Prisma.JsonValue): Prisma.InputJsonArray {
  if (!Array.isArray(items) || !linesSchema.safeParse(items).success) return conflict();
  return items;
}
function assertSourceBasis(row: Row, source: { items: unknown; total: number }, binding: CheckoutCouponBinding) {
  const session = toCheckoutSession(row);
  if (paymentCartFingerprint(session) !== binding.basisHash) return conflict();
  assertCapturedStorefrontCouponSourceProjection(source, session.cart);
}

function conflict(): never { throw new ConflictException("checkout_coupon_binding_conflict"); }
function identity(binding: CheckoutCouponBinding) {
  const { state: _state, ...value } = binding;
  Reflect.deleteProperty(value, "orderId");
  return parseCheckoutCouponPaymentAuthority(value);
}
export function checkoutCouponReleaseReceiptId(binding: CheckoutCouponBinding): string {
  return "evt_checkout_coupon_release_" + createHash("sha256").update(JSON.stringify([
    binding.merchantId, binding.bindingId, binding.redemptionId,
  ])).digest("hex");
}
function checkedBinding(row: Row) {
  const binding = readStoredCheckoutCouponBinding(row.cart);
  if (!binding || row.merchantId !== binding.merchantId || row.sessionId !== binding.checkoutSessionId
    || row.globalUserId !== binding.buyerId || stripStoredCheckoutCouponBinding(row.cart).cart_ref !== binding.cartId
    || !Number.isSafeInteger(row.version)) return conflict();
  return binding;
}
async function assertResolved(tx: Prisma.TransactionClient, row: Row, binding: CheckoutCouponBinding) {
  const scope = { merchantId: row.merchantId, sessionId: row.sessionId };
  if (await tx.completedOrder.findFirst({ where: scope, select: { id: true } })
    || await tx.checkoutChatRequest.findFirst({ where: { ...scope, status: { in: ["processing", "unknown"] } }, select: { id: true } })) return conflict();
  try {
    assertBoundCouponReleasePaymentsResolved({ ...binding, state: "active" },
      await tx.paymentIntent.findMany({ where: scope, select: paymentSelect }));
  } catch { return conflict(); }
}

/** Read-only historical proof. Caller already owns the cart fence.
 * Never acquire an earlier checkout/payment lock after the cart. The immutable
 * receipt proves the exact source release commit; a later legitimate reapply
 * may reuse redemptionId, so live reservation status is NOT historical proof. */
export async function validateReleasedCheckoutCouponGeneration(tx: Prisma.TransactionClient, row: Row): Promise<void> {
  const binding = checkedBinding(row);
  if (binding.state !== "released") return conflict();
  const parsed = receiptSchema.safeParse(await tx.outboxMessage.findFirst({ where: {
    merchantId: row.merchantId, eventId: checkoutCouponReleaseReceiptId(binding), eventType: "checkout.cart.updated",
  }, select: { eventId: true, merchantId: true, eventType: true, schemaVersion: true, producer: true, payload: true } }));
  if (!parsed.success || parsed.data.eventId !== checkoutCouponReleaseReceiptId(binding)
    || parsed.data.merchantId !== binding.merchantId || parsed.data.payload.session_id !== binding.checkoutSessionId
    || !isDeepStrictEqual(parseCheckoutCouponPaymentAuthority(parsed.data.payload.coupon_release.authority), identity(binding))) return conflict();
  await assertResolved(tx, row, binding);
}

/** Dedicated release command. Merchant/checkout anchor+row are already held by
 * the repository. Its exact CAS/source changes/receipt commit in that same TX.
 * No provider call, usage decrement, automatic retry or generic binding write. */
export async function releaseBoundCheckoutCouponForEdit(tx: Prisma.TransactionClient, row: Row, section: CheckoutEditSection) {
  const binding = checkedBinding(row);
  if (binding.state === "redeemed") return conflict();
  await lockStorefrontCart(tx, binding.merchantId, binding.cartId);
  if (binding.state === "released") {
    await validateReleasedCheckoutCouponGeneration(tx, row);
    return { session: reopenCheckout(toCheckoutSession(row), section), binding };
  }
  await assertResolved(tx, row, binding);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM coupons WHERE merchant_id=${binding.merchantId}
    AND id=${binding.couponId} FOR UPDATE`;
  if (locked.length !== 1 || locked[0]?.id !== binding.couponId) return conflict();
  const reservation = await tx.couponRedemption.findFirst({ where: { id: binding.redemptionId, merchantId: binding.merchantId,
    sessionId: binding.cartId, couponId: binding.couponId } });
  const source = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: binding.merchantId, sessionId: binding.cartId } } });
  const publicCart = stripStoredCheckoutCouponBinding(row.cart);
  const sourceCode = publicCart.commercialNudge?.couponCode;
  if (!reservation || reservation.status !== "applied" || reservation.orderId !== null
    || reservation.buyerGlobalUserId !== binding.reservationBuyerId || !Prisma.Decimal.isDecimal(reservation.discountApplied)
    || !reservation.discountApplied.times(100).isInteger() || reservation.discountApplied.times(100).toNumber() !== binding.discountCents
    || !source || source.merchantId !== binding.merchantId || source.sessionId !== binding.cartId
    || !sourceCode || source.couponCode !== sourceCode || source.discount !== binding.discountCents
    || Math.round((publicCart.currentDiscount ?? 0) * 100) !== binding.discountCents) return conflict();
  assertSourceBasis(row, source, binding);
  const eventId = checkoutCouponReleaseReceiptId(binding);
  if (await tx.outboxMessage.findFirst({ where: { eventId, merchantId: binding.merchantId }, select: { eventId: true } })) return conflict();
  const cancelled = await tx.couponRedemption.updateMany({ where: { id: binding.redemptionId, merchantId: binding.merchantId,
    sessionId: binding.cartId, couponId: binding.couponId, buyerGlobalUserId: binding.reservationBuyerId,
    discountApplied: reservation.discountApplied, status: "applied", orderId: null }, data: { status: "cancelled" } });
  if (cancelled.count !== 1) return conflict();
  const cartChanged = await tx.storefrontCart.updateMany({ where: { id: source.id, merchantId: binding.merchantId, sessionId: binding.cartId,
    items: { equals: sourceItemsForCas(source.items) }, total: source.total, couponCode: source.couponCode, discount: source.discount,
    freeShipping: source.freeShipping, updatedAt: source.updatedAt }, data: { couponCode: null, discount: 0 } });
  if (cartChanged.count !== 1) return conflict();
  const session = reopenCheckout(toCheckoutSession(row), section);
  const payload = { session_id: row.sessionId, currency: "BRL" as const, total: session.cart.total,
    item_count: session.cart.items.reduce((sum, item) => sum + item.quantity, 0),
    coupon_release: { version: 1 as const, authority: identity(binding) } };
  await appendOutboxInTransaction(tx, { ...createCheckoutEventEnvelope({ eventType: "checkout.cart.updated", merchantId: row.merchantId,
    causationId: binding.bindingId, payload }), event_id: eventId });
  const receipt = receiptSchema.safeParse(await tx.outboxMessage.findFirst({ where: { merchantId: row.merchantId, eventId },
    select: { eventId: true, merchantId: true, eventType: true, schemaVersion: true, producer: true, payload: true } }));
  if (!receipt.success || !isDeepStrictEqual(receipt.data.payload, payload)) return conflict();
  return { session, binding: { ...binding, state: "released" as const } };
}

/** Unbound checkout cancellation never had a captured payment generation.
 * Caller proves no payment rows and no canonical cart owner under its fences. */
export async function cancelUnboundStorefrontCouponSource(tx: Prisma.TransactionClient, candidate: Readonly<StorefrontCouponCheckoutCandidate>) {
  const source = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: candidate.merchantId, sessionId: candidate.cartId } } });
  const reservation = await tx.couponRedemption.findFirst({ where: { id: candidate.redemptionId, merchantId: candidate.merchantId,
    sessionId: candidate.cartId, couponId: candidate.couponId } });
  if (!source || source.couponCode !== candidate.couponCode || source.discount !== candidate.discountCents
    || !reservation || reservation.status !== "applied" || reservation.orderId !== null
    || reservation.buyerGlobalUserId !== candidate.reservationBuyerId || !Prisma.Decimal.isDecimal(reservation.discountApplied)
    || !reservation.discountApplied.times(100).isInteger() || reservation.discountApplied.times(100).toNumber() !== candidate.discountCents) return conflict();
  await cancelUnboundStorefrontCouponReservation(tx, candidate);
  const cart = await tx.storefrontCart.updateMany({ where: { id: source.id, merchantId: candidate.merchantId, sessionId: candidate.cartId,
    items: { equals: sourceItemsForCas(source.items) }, total: source.total, discount: source.discount, couponCode: source.couponCode,
    freeShipping: source.freeShipping, updatedAt: source.updatedAt }, data: { couponCode: null, discount: 0 } });
  if (cart.count !== 1) return conflict();
}

