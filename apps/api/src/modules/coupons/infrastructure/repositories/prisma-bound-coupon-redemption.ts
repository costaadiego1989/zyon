import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parseCheckoutCouponOrderAuthority, planBoundCouponRedemption } from "../../../checkout/domain/services/checkout-coupon-binding.js";
import { readStoredCheckoutCouponBinding, stripStoredCheckoutCouponBinding, preserveStoredCheckoutCouponBinding } from "../../../checkout/domain/services/checkout-coupon-storage.js";
import { readPaymentCouponAuthority } from "../../../payment/domain/payment-coupon-authority.js";
import { assertPaymentAmount, orderTotalCents } from "../../../payment/domain/payment-amount.js";
import { lockCheckoutSessionAnchor } from "../../../../shared/persistence/checkout-session-lock.js";
import { lockStorefrontCart } from "../../../../shared/persistence/storefront-cart-lock.js";
import { appendOutboxInTransaction } from "../../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { redeemNormalCheckoutCouponFromOrder } from "./prisma-normal-checkout-coupon-redemption.js";

const reference = z.string().min(1).max(191).refine(value => value.trim().length > 0 && !value.includes("\0"));
const inputSchema = z.strictObject({ merchantId: reference, eventId: reference });
const eventSchema = z.object({ eventId: reference, merchantId: reference, eventType: z.literal("order.completed"), schemaVersion: z.literal(1), correlationId: reference,
  payload: z.object({ session_id: reference, external_order_id: reference, payment_intent_id: reference, coupon_authority: z.unknown() }) });
const receiptSchema = z.object({ eventId: reference, eventType: z.literal("coupon.redeemed"), merchantId: reference, payload: z.unknown() });
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const paymentBreakdownSchema = z.object({ version: z.literal(1), currency: z.literal("BRL"),
  itemsSubtotalCents: cents, discountCents: cents, shippingCents: cents, platformFeeCents: cents, totalCents: cents.positive() });
function conflict(): never { throw new Error("checkout_coupon_binding_conflict"); }
function checked<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  try { const result = schema.safeParse(input); if (result.success) return result.data; } catch { /* No raw payload/cause in conflicts. */ }
  return conflict();
}
function exactCents(value: Prisma.Decimal, allowZero = false): number {
  if (!Prisma.Decimal.isDecimal(value)) return conflict();
  const cents = value.times(100);
  if (!cents.isInteger() || cents.lt(allowZero ? 0 : 1) || cents.gt(Number.MAX_SAFE_INTEGER)) return conflict();
  return cents.toNumber();
}
const eventSelect = { eventId: true, merchantId: true, eventType: true, schemaVersion: true, correlationId: true, payload: true } as const;
function frozenEvent(row: unknown, input: z.output<typeof inputSchema>) {
  const source = checked(eventSchema, row);
  const authority = parseCheckoutCouponOrderAuthority(source.payload.coupon_authority);
  if (source.eventId !== input.eventId || source.merchantId !== input.merchantId || authority.merchantId !== input.merchantId
    || source.payload.session_id !== authority.checkoutSessionId || source.payload.external_order_id !== authority.orderId) return conflict();
  return { sourceEventId: source.eventId, merchantId: source.merchantId, correlationId: source.correlationId,
    paymentIntentId: source.payload.payment_intent_id, authority };
}

/** INTERNAL command wired only for persisted bound order sources.
 * Requires an order.completed authority already frozen in storage by a trusted
 * publisher AND the preserved payment journal. It cannot issue/capture authority
 * or infer it from a current cart. Binding issuance/payment admission remain
 * guarded separately; wiring this consumer does not activate their production.
 * No external calls, retries, release policy, schema change or provider input. */
export class PrismaBoundCouponRedemption {
  constructor(private readonly prisma: PrismaClient) {}

  async redeem(rawInput: unknown): Promise<void> {
    const input = checked(inputSchema, rawInput);
    const readSource = (tx: Pick<Prisma.TransactionClient, "outboxMessage">) => tx.outboxMessage.findFirst({
      where: { merchantId: input.merchantId, eventId: input.eventId, eventType: "order.completed" }, select: eventSelect,
    });
    const source=await readSource(this.prisma);
    if(source?.payload&&typeof source.payload==="object"&&"normal_coupon_owner"in source.payload)
      return redeemNormalCheckoutCouponFromOrder(this.prisma,input);
    const frozen = frozenEvent(source, input);
    await this.prisma.$transaction(async tx => {
      const a = frozen.authority;
      const merchant = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id=${input.merchantId} FOR UPDATE`;
      if (merchant.length !== 1 || merchant[0]?.id !== input.merchantId) return conflict();
      await lockCheckoutSessionAnchor(tx, input.merchantId, a.checkoutSessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${input.merchantId} AND session_id=${a.checkoutSessionId} FOR UPDATE`;
      const checkout = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: a.checkoutSessionId } },
        select: { id: true, merchantId: true, sessionId: true, globalUserId: true, version: true, cart: true } });
      if (!checkout || checkout.merchantId !== input.merchantId || checkout.sessionId !== a.checkoutSessionId || checkout.globalUserId !== a.buyerId
        || !Number.isSafeInteger(checkout.version)) return conflict();
      await lockStorefrontCart(tx, input.merchantId, a.cartId);
      const binding = readStoredCheckoutCouponBinding(checkout.cart);
      if (!binding) return conflict();
      preserveStoredCheckoutCouponBinding(checkout.cart, stripStoredCheckoutCouponBinding(checkout.cart),
        { merchantId: input.merchantId, sessionId: a.checkoutSessionId, buyerId: a.buyerId });
      const coupon = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM coupons WHERE merchant_id=${input.merchantId} AND id=${a.couponId} FOR UPDATE`;
      if (coupon.length !== 1 || coupon[0]?.id !== a.couponId) return conflict();
      const sourceLocked = await tx.$queryRaw<Array<{ id: string }>>`SELECT event_id AS id FROM outbox_messages
        WHERE merchant_id=${input.merchantId} AND event_id=${input.eventId} AND event_type='order.completed' FOR SHARE`;
      if (sourceLocked.length !== 1 || !isDeepStrictEqual(frozenEvent(await readSource(tx), input), frozen)) return conflict();
      const [order, payment, redemption] = await Promise.all([
        tx.completedOrder.findFirst({ where: { merchantId: input.merchantId, sessionId: a.checkoutSessionId, externalOrderId: a.orderId },
          select: { merchantId: true, sessionId: true, externalOrderId: true, orderTotal: true, currency: true } }),
        tx.paymentIntent.findFirst({ where: { merchantId: input.merchantId, sessionId: a.checkoutSessionId, id: frozen.paymentIntentId },
          select: { id: true, merchantId: true, sessionId: true, providerPaymentId: true, amountCents: true, approvedAmountCents: true, currency: true, method: true, creation: true, amountBreakdown: true } }),
        tx.couponRedemption.findFirst({ where: { id: a.redemptionId, merchantId: input.merchantId, sessionId: a.cartId, couponId: a.couponId },
          select: { id: true, merchantId: true, sessionId: true, couponId: true, buyerGlobalUserId: true, discountApplied: true, status: true, orderId: true } }),
      ]);
      if (!order || !payment || !redemption || order.merchantId !== input.merchantId || order.sessionId !== a.checkoutSessionId
        || order.externalOrderId !== a.orderId || order.currency !== "BRL" || payment.currency !== order.currency
        || payment.id !== frozen.paymentIntentId || payment.merchantId !== input.merchantId || payment.sessionId !== a.checkoutSessionId
        || payment.providerPaymentId !== a.orderId || payment.approvedAmountCents !== payment.amountCents) return conflict();
      const paymentCents = checked(cents.positive(), payment.amountCents);
      const breakdown = payment.amountBreakdown == null ? undefined : checked(paymentBreakdownSchema, payment.amountBreakdown);
      if (breakdown) {
        try { assertPaymentAmount(breakdown, paymentCents, payment.currency); } catch { return conflict(); }
        if (breakdown.discountCents !== a.discountCents) return conflict();
      }
      if (orderTotalCents(breakdown, paymentCents) !== exactCents(order.orderTotal, true)) return conflict();
      const { orderId: _orderId, ...identity } = a;
      const method = checked(z.enum(["pix", "card", "boleto", "crypto"]), payment.method);
      if (!isDeepStrictEqual(readPaymentCouponAuthority({ ...payment, method }), identity)) return conflict();
      const plan = planBoundCouponRedemption({ binding, orderAuthority: a, redemption: {
        id: redemption.id, merchantId: redemption.merchantId, sessionId: redemption.sessionId, couponId: redemption.couponId,
        buyerGlobalUserId: redemption.buyerGlobalUserId, discountCents: exactCents(redemption.discountApplied), status: redemption.status, orderId: redemption.orderId,
      } });
      const receiptId = "evt_bound_coupon_" + createHash("sha256").update(JSON.stringify([input.merchantId, a.bindingId, a.redemptionId, a.orderId])).digest("hex");
      const payload = { session_id: a.checkoutSessionId, coupon_id: a.couponId, order_id: a.orderId,
        discount_applied: a.discountCents / 100, buyer_global_user_id: a.reservationBuyerId ?? "" };
      const readReceipt = () => tx.outboxMessage.findFirst({ where: { eventId: receiptId, merchantId: input.merchantId }, select: { eventId: true, eventType: true, merchantId: true, payload: true } });
      const receipt = await readReceipt();
      const expectedReceipt = { eventId: receiptId, eventType: "coupon.redeemed", merchantId: input.merchantId, payload };
      if (plan.kind === "already_redeemed") {
        if (binding.state !== "redeemed" || binding.orderId !== a.orderId || !isDeepStrictEqual(checked(receiptSchema, receipt), expectedReceipt)) return conflict();
        return;
      }
      if (receipt !== null) return conflict();
      const changed = await tx.couponRedemption.updateMany({ where: { id: a.redemptionId, merchantId: input.merchantId, sessionId: a.cartId,
        couponId: a.couponId, buyerGlobalUserId: a.reservationBuyerId, discountApplied: redemption.discountApplied, status: "applied", orderId: null },
        data: { status: "redeemed", orderId: a.orderId } });
      if (changed.count !== 1) return conflict();
      const usage = await tx.coupon.updateMany({ where: { merchantId: input.merchantId, id: a.couponId }, data: { usagesCount: { increment: 1 } } });
      if (usage.count !== 1) return conflict();
      const cart = { ...stripStoredCheckoutCouponBinding(checkout.cart), _storefrontCouponBinding: { ...binding, state: "redeemed", orderId: a.orderId } };
      const transitioned = await tx.checkoutSession.updateMany({ where: { id: checkout.id, merchantId: input.merchantId, sessionId: a.checkoutSessionId, version: checkout.version },
        data: { cart: cart as unknown as Prisma.InputJsonValue, updatedAt: new Date() } });
      if (transitioned.count !== 1) return conflict();
      await appendOutboxInTransaction(tx, { ...createCouponEventEnvelope({ eventType: "coupon.redeemed", merchantId: input.merchantId, payload,
        causationId: input.eventId }), event_id: receiptId, correlation_id: frozen.correlationId });
      if (!isDeepStrictEqual(checked(receiptSchema, await readReceipt()), expectedReceipt)) return conflict();
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
  }
}
