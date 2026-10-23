import { resolveBusinessPeriod } from "../../../../shared/analytics/business-period.js";
import { lockCheckoutSessionAnchor } from "../../../../shared/persistence/checkout-session-lock.js";
import { createDigitalOrderFulfillment } from "../../../../shared/persistence/digital-order-fulfillment.js";
import { initializeOrderFulfillment } from "../../../../shared/persistence/order-fulfillment.js";
import { toCheckoutSession, toCheckoutShippingJson } from "./checkout-session.mapper.js";
import { isDeepStrictEqual } from "node:util";
import { parseCheckoutCouponOrderAuthority, type CheckoutCouponOrderAuthority } from "../../domain/services/checkout-coupon-binding.js";
import { ConflictException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AcceptedOffer,
  AuthorizedOffer,
  Cart,
  ChatTurn,
  CheckoutEventName,
  CheckoutSession,
  CompletedOrder,
  CompletedOrderStatus,
  CurrencyCode,
  CustomerHints,
  DashboardOverview,
  DomainEventEnvelope,
  MerchantRules,
  OfferType,
  StorePeriod
} from "@zyon/shared-types";
import { readPaymentCouponAuthority } from "../../../payment/domain/payment-coupon-authority.js";
import type { PaymentMethod } from "../../../payment/domain/payment-intent.entity.js";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import type { CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import { CheckoutAbandonmentService } from "../../domain/services/checkout-abandonment.service.js";
import { CheckoutIdentityService } from "../../domain/services/checkout-identity.service.js";
import { toNumber, toNumberOrNull, type DecimalLike } from "../../../../shared/persistence/decimal.util.js";
import { OrderQuotaService } from "../../../payment/application/services/order-quota.service.js";
import { strategyExecutionEnabled } from "../../../revenue-manager/domain/strategy-execution.js";
import { enrollCreatedStrategySession, executionClock, lockExecutionMerchant } from "../../../revenue-manager/infrastructure/strategy-execution-ledger.js";
import type { ChatExchangeInput, CheckoutCommercialMutation } from "../../domain/ports/checkout-session.repository.port.js";
import { prepareCommercialMutation } from "../../domain/services/checkout-commercial-mutation.js";
import { digest } from "../../../experiments/domain/services/measurement-plan.js";
import { chatMessageTextHash } from "../../application/services/chat-message-identity.js";
import { deriveChatStage } from "../../domain/services/customer-extraction.service.js";
import { paymentCartFingerprint } from "../../domain/services/payment-cart-fingerprint.js";
import { chatPaymentRecoveryEnabled } from "../../application/services/chat-payment-recovery.js";
import { applyEligibleIncentive, incentiveExecutionEnabled, invalidateIncentiveCheckout, prepareProgressiveIncentivePayment, reviseIncentiveForPaymentReview } from "../../../revenue-manager/infrastructure/incentive-execution-ledger.js";
import { reopenCheckout } from "../../domain/services/reopen-checkout.js";
import { assertNoCheckoutCouponBindingInput, hasStoredCheckoutCouponBinding,
  preserveStoredCheckoutCouponBinding, readStoredCheckoutCouponBinding, stripStoredCheckoutCouponBinding } from "../../domain/services/checkout-coupon-storage.js";
import { toMerchantRules } from "./merchant-rules.mapper.js";
import { prepareStorefrontCouponFormMutation, prepareStorefrontCouponPaymentBenefits } from "./prisma-checkout-coupon-form.js";
import { releaseBoundCheckoutCouponForEdit, cancelUnboundStorefrontCouponSource } from "../../../../shared/persistence/storefront-coupon/generation-release.js";
import { lockStorefrontCart } from "../../../../shared/persistence/storefront-cart-lock.js";
import { readStorefrontCheckoutBindingOwners } from "../../../../shared/persistence/storefront-coupon/cart-owner-fence.js";
import { assertNoUnprojectedWidgetReceipt } from "../../domain/services/checkout-widget-receipt-boundary.js";
import { assertWidgetPaymentOrderInTransaction } from "../adapters/widget-payment-order-authority.js";
import type { WidgetCheckoutPaymentAuthority } from "../../../payment/domain/widget-checkout-payment-authority.schemas.js";
import type { NormalCheckoutPaymentAuthority } from "../../../payment/domain/normal-checkout-payment-authority.schemas.js";
import { assertNormalCrossSellPaymentOrderInTransaction } from "../adapters/normal-cross-sell-payment-order-authority.js";
import { verifyNormalCheckoutEmailOtpInTransaction, readVerifiedNormalCheckoutBuyerIdentityInTransaction } from "../../../../shared/persistence/normal-checkout-email-otp-verification.js";
import { detachNormalCheckoutBuyerEmailInTransaction } from "../../../../shared/persistence/normal-checkout-email-detachment.js";
import type { CheckoutEmailOtpVerificationScope, CheckoutEmailOtpVerificationCommand } from "../../domain/services/checkout-email-otp-verification.js";
import type { ChatExchangeClaim } from "../../domain/ports/checkout-session.repository.port.js";

// P2 fix: single canonical default — no inline copy here.
const DEFAULT_RULES: MerchantRules = DEFAULT_MERCHANT_RULES;

/** A generic save cannot repair corrupted ownership or change the financial
 * session context around an immutable bound cart. JSON null/absence are equal;
 * nonfinancial session metadata is deliberately outside this comparison. */
function assertBoundCheckoutSessionContextPreserved(current: {
  cart: unknown; globalUserId: string; customer?: unknown; shipping?: unknown; crossStoreItems?: unknown;
}, next: CheckoutSession): void {
  const binding = readStoredCheckoutCouponBinding(current.cart);
  if (!binding) return;
  try {
    const context = (value: { customer?: unknown; shipping?: unknown; crossStoreItems?: unknown }) =>
      digest(JSON.parse(JSON.stringify([value.customer ?? null, value.shipping ?? null, value.crossStoreItems ?? null])));
    if (current.globalUserId !== binding.buyerId || context(current) !== context(next)) {
      throw new Error("checkout_coupon_binding_conflict");
    }
  } catch {
    throw new Error("checkout_coupon_binding_conflict");
  }
}

export class PrismaCheckoutRepository implements CheckoutRepository {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
    private readonly inTransaction = false,
    private readonly orderQuota?: OrderQuotaService,
  ) {}

  async transaction<T>(work: (repository: CheckoutRepository) => Promise<T>): Promise<T> {
    if (this.inTransaction) return work(this);
    return (this.prisma as PrismaClient).$transaction((tx) => work(new PrismaCheckoutRepository(tx, true, this.orderQuota)));
  }

  async verifyEmailOtpAndRecognize(scope: CheckoutEmailOtpVerificationScope, command: CheckoutEmailOtpVerificationCommand,
    claim?: ChatExchangeClaim): Promise<CheckoutSession | undefined> {
    const scoped = structuredClone(scope), input = structuredClone(command), ownedClaim = claim ? structuredClone(claim) : undefined;
    const work = (tx: Prisma.TransactionClient) => verifyNormalCheckoutEmailOtpInTransaction(tx, scoped, input, ownedClaim);
    return this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work);
  }

  async readVerifiedNormalBuyerIdentity(scope: CheckoutEmailOtpVerificationScope,
    expected: { expectedVersion: number; expectedBuyerId: string }): Promise<string | undefined> {
    const scoped = structuredClone(scope), input = structuredClone(expected);
    const work = (tx: Prisma.TransactionClient) => readVerifiedNormalCheckoutBuyerIdentityInTransaction(tx, scoped, input);
    return this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work);
  }

  async detachNormalBuyerEmail(scope: CheckoutEmailOtpVerificationScope, command: { expectedVersion: number; email: string },
    claim?: ChatExchangeClaim): Promise<CheckoutSession | undefined> {
    const scoped = structuredClone(scope), input = structuredClone(command), ownedClaim = claim ? structuredClone(claim) : undefined;
    const work = (tx: Prisma.TransactionClient) => detachNormalCheckoutBuyerEmailInTransaction(tx, scoped, input, ownedClaim);
    return this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work);
  }

  async assertPublicCompletionAllowed(merchantId: string, sessionId: string): Promise<void> {
    return this.assertCouponOrderAuthority(merchantId, sessionId);
  }

  async assertWidgetPaymentOrderAuthority(merchantId: string, sessionId: string, authority: WidgetCheckoutPaymentAuthority,
    paymentIntentId: string, providerPaymentId: string): Promise<void> {
    // A completed detached check cannot authorize later order/outbox writes.
    // CompleteOrder must call this on the repository supplied by transaction().
    if (!this.inTransaction) throw new Error("payment_widget_checkout_authority_conflict");
    await assertWidgetPaymentOrderInTransaction(this.prisma as Prisma.TransactionClient, merchantId, sessionId, authority, paymentIntentId, providerPaymentId);
  }

  async assertNormalCrossSellPaymentOrderAuthority(merchantId:string,sessionId:string,authority:NormalCheckoutPaymentAuthority,
    paymentIntentId:string,providerPaymentId:string):Promise<void>{
    if(!this.inTransaction)throw new Error("payment_normal_cross_sell_authority_conflict");
    await assertNormalCrossSellPaymentOrderInTransaction(this.prisma as Prisma.TransactionClient,merchantId,sessionId,authority,paymentIntentId,providerPaymentId);
  }

  async assertCouponOrderAuthority(merchantId: string, sessionId: string, authority?: CheckoutCouponOrderAuthority, paymentIntentId?: string): Promise<void> {
    const check = async (tx: Prisma.TransactionClient) => {
      await lockExecutionMerchant(tx, merchantId);
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${merchantId} AND session_id=${sessionId} FOR UPDATE`;
      const stored = await tx.checkoutSession.findUnique({
        where: { merchantId_sessionId: { merchantId, sessionId } }, select: { cart: true, globalUserId: true },
      });
      assertNoUnprojectedWidgetReceipt(stored?.cart);
      if (!authority) {
        assertNoCheckoutCouponBindingInput(stored?.cart);
        const cart=stored?.cart as {source?:unknown;items?:unknown}|null;
        const hasIntent=Array.isArray(cart?.items)&&cart.items.some(item=>item!==null&&typeof item==="object"&&"crossSellIntent"in item);
        if(hasIntent&&(cart?.source!=="storefront"||await tx.outboxMessage.findFirst({where:{merchantId,eventType:"cross-sell.offer.accepted",
          producer:"cross-sell",payload:{path:["ack","sessionId"],equals:sessionId}},select:{eventId:true}})))
          throw new Error("payment_approval_required");
        return;
      }
      const frozen = parseCheckoutCouponOrderAuthority(authority);
      const binding = readStoredCheckoutCouponBinding(stored?.cart);
      if (!stored || !binding || binding.state === "released" || binding.state === "redeemed" && binding.orderId !== frozen.orderId) {
        throw new Error("checkout_coupon_binding_conflict");
      }
      const { state: _state, ...bindingIdentity } = binding;
      Reflect.deleteProperty(bindingIdentity, "orderId");
      const { orderId: _orderId, ...frozenIdentity } = frozen;
      if (!isDeepStrictEqual(bindingIdentity, frozenIdentity)) throw new Error("checkout_coupon_binding_conflict");
      preserveStoredCheckoutCouponBinding(stored.cart, stripStoredCheckoutCouponBinding(stored.cart),
        { merchantId, sessionId, buyerId: stored.globalUserId });
      if (typeof paymentIntentId !== "string" || !paymentIntentId.trim() || paymentIntentId.length > 191) throw new Error("checkout_coupon_binding_conflict");
      const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId, sessionId }, select: {
        id: true, merchantId: true, sessionId: true, status: true, amountCents: true, approvedAmountCents: true,
        providerPaymentId: true, currency: true, method: true, creation: true,
      } });
      if (!payment || payment.status !== "approved" || payment.currency !== "BRL" || payment.providerPaymentId !== frozen.orderId
        || !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 || payment.approvedAmountCents !== payment.amountCents
        || !["pix", "card", "boleto", "crypto"].includes(payment.method)) throw new Error("checkout_coupon_binding_conflict");
      try {
        if (!isDeepStrictEqual(readPaymentCouponAuthority({ ...payment, method: payment.method as PaymentMethod }), frozenIdentity)) {
          throw new Error();
        }
      } catch { throw new Error("checkout_coupon_binding_conflict"); }
    };
    if (this.inTransaction) await check(this.prisma);
    else await (this.prisma as PrismaClient).$transaction(check);
  }

  async reviseIncentiveForPaymentReview(merchantId: string, sessionId: string): Promise<CheckoutSession | undefined> {
    const work = (tx: Prisma.TransactionClient) => reviseIncentiveForPaymentReview(tx, merchantId, sessionId);
    return this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work);
  }

  async prepareProgressiveIncentivePayment(merchantId: string, sessionId: string, method: string): Promise<CheckoutSession | undefined> {
    const work = (tx: Prisma.TransactionClient) => prepareProgressiveIncentivePayment(tx, merchantId, sessionId, method);
    const row = await (this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work));
    return row ? toCheckoutSession(row) : undefined;
  }

  async getRules(merchantId: string): Promise<MerchantRules> {
    const row = await this.prisma.merchantRule.upsert({
      where: { merchantId },
      create: toMerchantRuleCreate(merchantId, DEFAULT_RULES),
      update: {}
    });
    return toMerchantRules(row);
  }

  async updateRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    return this.setRules(merchantId, rules);
  }

  async setRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    const current = await this.getRules(merchantId);
    const next = { ...current, ...rules };
    const row = await this.prisma.merchantRule.upsert({
      where: { merchantId },
      create: toMerchantRuleCreate(merchantId, next),
      update: toMerchantRuleUpdate(next)
    });
    return toMerchantRules(row);
  }

  async resolveGlobalUserId(merchantId: string, customer?: CustomerHints): Promise<string> {
    const identityKey = CheckoutIdentityService.identityKey(merchantId, customer);
    if (!identityKey) return `usr_${crypto.randomUUID()}`;
    const localKey = identityKey.slice(`${merchantId}:`.length);
    const row = await this.prisma.buyerIdentity.upsert({
      where: { merchantId_identityKey: { merchantId, identityKey: localKey } },
      create: { merchantId, identityKey: localKey, globalUserId: `usr_${crypto.randomUUID()}` },
      update: {}
    });
    return row.globalUserId;
  }

  async saveSession(session: CheckoutSession): Promise<void> {
    assertNoUnprojectedWidgetReceipt(session.cart);
    assertNoCheckoutCouponBindingInput(session.cart);
    const snapshot = structuredClone(session);
    const write = async (tx: Prisma.TransactionClient) => {
      const scope = { merchantId: snapshot.merchantId, sessionId: snapshot.sessionId };
      if (incentiveExecutionEnabled(scope.merchantId)) await lockExecutionMerchant(tx, scope.merchantId);
      await lockCheckoutSessionAnchor(tx, scope.merchantId, scope.sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${scope.merchantId}
        AND session_id = ${scope.sessionId} FOR UPDATE`;
      const current = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
      assertNoUnprojectedWidgetReceipt(current?.cart);
      if (!current) {
        // A concurrent insertion must not be turned into an unversioned update.
        const created = await tx.checkoutSession.create({ data: toCheckoutSessionCreate(snapshot) as any });
        return applyEligibleIncentive(tx, created);
      }
      const bound = hasStoredCheckoutCouponBinding(current.cart);
      if (bound && (!Number.isSafeInteger(snapshot.persistenceVersion) || snapshot.persistenceVersion !== current.version)) {
        throw new Error("checkout_coupon_binding_conflict");
      }
      if (bound) assertBoundCheckoutSessionContextPreserved(current, snapshot);
      const cart = preserveStoredCheckoutCouponBinding(current.cart, snapshot.cart,
        { ...scope, buyerId: snapshot.globalUserId });
      const owned = !!await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: scope }, select: { id: true } })
        || !!await tx.strategyIncentiveAssignment.findUnique({ where: { merchantId_sessionId: scope }, select: { id: true } })
        || !!await tx.checkoutChatRequest.findFirst({ where: scope, select: { id: true } });
      if ((owned || snapshot.persistenceVersion !== undefined)
        && (!Number.isSafeInteger(snapshot.persistenceVersion) || snapshot.persistenceVersion !== current.version)) {
        throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
      }
      const saved = await tx.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: toCheckoutSessionUpdate({ ...snapshot, cart }) as any });
      return bound ? saved : applyEligibleIncentive(tx, saved);
    };
    const saved = this.inTransaction ? await write(this.prisma) : await (this.prisma as PrismaClient).$transaction(write);
    // Existing callers persist a working object several times. Advance only the
    // server token after a successful write, never rebase a stale snapshot.
    session.persistenceVersion = saved.version;
    session.cart = toCheckoutSession(saved).cart;
  }

  async commitCommercialMutation(input: CheckoutCommercialMutation): Promise<CheckoutSession> {
    assertNoUnprojectedWidgetReceipt(input.expected.cart);
    assertNoUnprojectedWidgetReceipt(input.next.cart);
    assertNoCheckoutCouponBindingInput(input.expected.cart);
    assertNoCheckoutCouponBindingInput(input.next.cart);
    input = structuredClone(input);
    const work = async (tx: Prisma.TransactionClient) => {
      const { merchantId, sessionId } = input.expected;
      await lockExecutionMerchant(tx, merchantId);
      await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id=${merchantId} FOR UPDATE`;
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId} AND session_id = ${sessionId} FOR UPDATE`;
      const stored = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
      assertNoUnprojectedWidgetReceipt(stored?.cart);
      if (stored && stripStoredCheckoutCouponBinding(stored.cart).source === "storefront") {
        const binding = readStoredCheckoutCouponBinding(stored.cart);
        if (binding && binding.state !== "released") assertNoCheckoutCouponBindingInput(stored.cart);
        const current = toCheckoutSession(stored);
        const hash = (value: CheckoutSession) => digest(JSON.parse(JSON.stringify(toCheckoutSessionCreate(value))));
        if (input.expected.persistenceVersion !== stored.version || hash(input.expected) !== hash(current)) {
          throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
        }
        if (await tx.paymentIntent.findFirst({ where: { merchantId, sessionId, status: { notIn: ["failed", "cancelled"] } }, select: { id: true } })) {
          throw new ConflictException("CHECKOUT_PAYMENT_REQUIRES_REOPEN");
        }
        if (await tx.completedOrder.findFirst({ where: { merchantId, sessionId }, select: { id: true } })
          || await tx.checkoutEvent.findFirst({ where: { merchantId, sessionId, eventName: "checkout_abandoned",
            metadata: { path: ["reason"], equals: "buyer_initiated" } }, select: { id: true } })) {
          throw new ConflictException("CHECKOUT_COMMERCIAL_SESSION_CLOSED");
        }
        const dedicated = await prepareStorefrontCouponFormMutation(tx, stored, input);
        if (dedicated) {
          if (input.cancel && dedicated.candidate) {
            if ((await tx.paymentIntent.findMany({ where: { merchantId, sessionId }, select: { id: true } })).length) {
              throw new ConflictException("CHECKOUT_PAYMENT_REQUIRES_REOPEN");
            }
            await cancelUnboundStorefrontCouponSource(tx, dedicated.candidate);
          }
          const cart = dedicated.binding ? { ...dedicated.session.cart, _storefrontCouponBinding: dedicated.binding } : dedicated.session.cart;
          const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, merchantId, sessionId, version: stored.version },
            data: { ...toCheckoutSessionUpdate(dedicated.session), cart: cart as unknown as Prisma.InputJsonValue } });
          if (saved.count !== 1) throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
          const repo = new PrismaCheckoutRepository(tx, true, this.orderQuota);
          if (dedicated.event) await repo.appendOutbox(dedicated.event);
          if (input.cancel) await repo.recordEvent(merchantId, sessionId, "checkout_abandoned", { source: "acp.protocol", reason: "buyer_initiated" });
          return (await repo.getSession(merchantId, sessionId))!;
        }
      }
      const mutation = prepareCommercialMutation(input);
      assertNoCheckoutCouponBindingInput(stored?.cart);
      if (mutation.invalidated && await tx.paymentIntent.findFirst({ where: { merchantId, sessionId,
        status: { notIn: ["failed", "cancelled"] } }, select: { id: true } })) {
        throw new ConflictException("CHECKOUT_PAYMENT_REQUIRES_REOPEN");
      }
      if (mutation.invalidated) await invalidateIncentiveCheckout(tx, merchantId, sessionId);
      if (await tx.completedOrder.findFirst({ where: { merchantId, sessionId }, select: { id: true } })
        || await tx.checkoutEvent.findFirst({ where: { merchantId, sessionId, eventName: "checkout_abandoned",
          metadata: { path: ["reason"], equals: "buyer_initiated" } }, select: { id: true } })) {
        throw new ConflictException("CHECKOUT_COMMERCIAL_SESSION_CLOSED");
      }
      const repository = new PrismaCheckoutRepository(tx, true, this.orderQuota);
      try {
        await repository.saveSessionIfUnchanged(mutation.session, input.expected);
      } catch (error) {
        if (error instanceof Error && error.message === "CHAT_SESSION_CHANGED") {
          throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
        }
        throw error;
      }
      if (mutation.invalidated) await tx.couponRedemption.updateMany({
        where: { merchantId, sessionId, status: "applied" }, data: { status: "cancelled" },
      });
      if (mutation.event) await repository.appendOutbox(mutation.event);
      if (input.cancel) await repository.recordEvent(merchantId, sessionId, "checkout_abandoned", {
        source: "acp.protocol", reason: "buyer_initiated",
      });
      return (await repository.getSession(merchantId, sessionId))!;
    };
    return this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work);
  }

  async saveSessionIfUnchanged(session: CheckoutSession, expected: CheckoutSession): Promise<void> {
    assertNoUnprojectedWidgetReceipt(session.cart);
    assertNoUnprojectedWidgetReceipt(expected.cart);
    assertNoCheckoutCouponBindingInput(session.cart);
    assertNoCheckoutCouponBindingInput(expected.cart);
    const working = session;
    session = structuredClone(session); expected = structuredClone(expected);
    if (session.merchantId !== expected.merchantId || session.sessionId !== expected.sessionId) {
      throw new Error("CHAT_SESSION_SCOPE_CONFLICT");
    }
    const write = async (tx: Prisma.TransactionClient) => {
      if (incentiveExecutionEnabled(session.merchantId)) await lockExecutionMerchant(tx, session.merchantId);
      await lockCheckoutSessionAnchor(tx, session.merchantId, session.sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${session.merchantId}
        AND session_id = ${session.sessionId} FOR UPDATE`;
      const where = { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } };
      const current = await tx.checkoutSession.findUnique({ where });
      assertNoUnprojectedWidgetReceipt(current?.cart);
      const bound = hasStoredCheckoutCouponBinding(current?.cart);
      if (bound && expected.persistenceVersion !== current?.version) throw new Error("checkout_coupon_binding_conflict");
      if (current && bound) assertBoundCheckoutSessionContextPreserved(current, session);
      const cart = current ? preserveStoredCheckoutCouponBinding(current.cart, session.cart,
        { merchantId: session.merchantId, sessionId: session.sessionId, buyerId: session.globalUserId }) : session.cart;
      const hash = (value: CheckoutSession) => digest(JSON.parse(JSON.stringify(toCheckoutSessionCreate(value))));
      if (!current || expected.persistenceVersion !== current.version
        || hash(expected) !== hash(toCheckoutSession(current))) throw new Error("CHAT_SESSION_CHANGED");
      const saved = await tx.checkoutSession.update({ where, data: toCheckoutSessionUpdate({ ...session, cart }) as any });
      return bound ? saved : applyEligibleIncentive(tx, saved);
    };
    const saved = this.inTransaction ? await write(this.prisma) : await (this.prisma as PrismaClient).$transaction(write);
    working.persistenceVersion = saved.version;
    working.cart = toCheckoutSession(saved).cart;
  }

  async assertBuyerEditAllowed(merchantId: string, sessionId: string): Promise<void> {
    const scope = { merchantId, sessionId };
    if (!await this.getSession(merchantId, sessionId)) throw new ConflictException("CHECKOUT_SESSION_NOT_FOUND");
    if (await this.prisma.completedOrder.findFirst({ where: scope, select: { id: true } })
      || await this.prisma.checkoutChatRequest.findFirst({ where: { ...scope, status: { in: ["processing", "unknown"] } }, select: { id: true } })
      || await this.prisma.checkoutEvent.findFirst({ where: { ...scope, eventName: "checkout_abandoned", metadata: { path: ["reason"], equals: "buyer_initiated" } }, select: { id: true } })) {
      throw new ConflictException("checkout_payment_not_editable");
    }
  }

  /** Internal fail-closed preflight. Absence of public metadata is not evidence
   * that storage has no binding; commands must inspect the canonical raw row. */
  async assertCouponBindingCommandAllowed(merchantId: string, sessionId: string): Promise<void> {
    const stored = await this.prisma.checkoutSession.findUnique({
      where: { merchantId_sessionId: { merchantId, sessionId } }, select: { cart: true },
    });
    assertNoUnprojectedWidgetReceipt(stored?.cart);
    assertNoCheckoutCouponBindingInput(stored?.cart);
  }

  async hasReleasedStorefrontCouponBinding(merchantId: string, sessionId: string): Promise<boolean> {
    const stored = await this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } }, select: { cart: true } });
    return readStoredCheckoutCouponBinding(stored?.cart)?.state === "released";
  }

  async prepareStorefrontCouponBenefits(merchantId: string, sessionId: string, method: string): Promise<CheckoutSession | undefined> {
    const work = async (tx: Prisma.TransactionClient) => {
      await lockExecutionMerchant(tx, merchantId);
      await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id=${merchantId} FOR UPDATE`;
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${merchantId} AND session_id=${sessionId} FOR UPDATE`;
      const stored = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
      if (!stored) throw new ConflictException("CHECKOUT_SESSION_NOT_FOUND");
      assertNoUnprojectedWidgetReceipt(stored.cart);
      if (await tx.paymentIntent.findFirst({ where: { merchantId, sessionId, status: { notIn: ["failed", "cancelled"] } }, select: { id: true } })
        || await tx.completedOrder.findFirst({ where: { merchantId, sessionId }, select: { id: true } })) {
        throw new ConflictException("CHECKOUT_PAYMENT_REQUIRES_REOPEN");
      }
      const prepared = await prepareStorefrontCouponPaymentBenefits(tx, stored, method);
      if (!prepared) return undefined;
      const cart = prepared.binding ? { ...prepared.session.cart, _storefrontCouponBinding: prepared.binding } : prepared.session.cart;
      const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, merchantId, sessionId, version: stored.version },
        data: { ...toCheckoutSessionUpdate(prepared.session), cart: cart as unknown as Prisma.InputJsonValue } });
      if (saved.count !== 1) throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
      const repo = new PrismaCheckoutRepository(tx, true, this.orderQuota);
      if (!prepared.history.includes("payment_method_selected")) {
        await repo.recordEvent(merchantId, sessionId, "payment_method_selected", { method, source: "payment_preparation" });
      }
      return (await repo.getSession(merchantId, sessionId))!;
    };
    return this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work, { isolationLevel: "ReadCommitted" });
  }

  async reopenForBuyerEdit(merchantId: string, sessionId: string, section: import("@zyon/shared-types").CheckoutEditSection): Promise<CheckoutSession> {
    const work = async (tx: Prisma.TransactionClient) => {
      await lockExecutionMerchant(tx, merchantId);
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId} AND session_id = ${sessionId} FOR UPDATE`;
      const scope = { merchantId, sessionId };
      const stored = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
      const repo = new PrismaCheckoutRepository(tx, true, this.orderQuota);
      await repo.assertBuyerEditAllowed(merchantId, sessionId);
      if (stored && hasStoredCheckoutCouponBinding(stored.cart)) {
        const binding = readStoredCheckoutCouponBinding(stored.cart)!;
        await lockStorefrontCart(tx, merchantId, binding.cartId);
        const owners = await readStorefrontCheckoutBindingOwners(tx, merchantId, binding.cartId);
        if (binding.state === "active" && (owners.length !== 1 || owners[0]?.sessionId !== sessionId
          || !isDeepStrictEqual(owners[0].binding, binding))) throw new ConflictException("checkout_coupon_binding_conflict");
        const released = await releaseBoundCheckoutCouponForEdit(tx, stored, section);
        // A tombstone can coexist with a later, not-yet-admitted source coupon.
        // Reopening that form must not silently delete its new canonical D.
        if (binding.state === "released" && (toCheckoutSession(stored).cart.currentDiscount ?? 0) > 0) {
          const current = toCheckoutSession(stored);
          const prepared = await prepareStorefrontCouponFormMutation(tx, stored, { expected: current,
            next: { ...released.session, cart: { ...released.session.cart,
              currentDiscount: current.cart.currentDiscount, commercialNudge: current.cart.commercialNudge } } });
          if (!prepared) throw new ConflictException("checkout_coupon_binding_conflict");
          released.session = prepared.session;
        }
        const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version },
          data: { ...toCheckoutSessionUpdate(released.session), cart: { ...released.session.cart,
            _storefrontCouponBinding: released.binding } as unknown as Prisma.InputJsonValue } });
        if (saved.count !== 1) throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
        return (await repo.getSession(merchantId, sessionId))!;
      }
      if (await tx.paymentIntent.findFirst({ where: { ...scope, status: { notIn: ["failed", "cancelled"] } }, select: { id: true } })) {
        throw new ConflictException("checkout_payment_not_editable");
      }
      const current = await repo.getSession(merchantId, sessionId);
      if (!current) throw new ConflictException("CHECKOUT_SESSION_NOT_FOUND");
      const next = reopenCheckout(current, section);
      await invalidateIncentiveCheckout(tx, merchantId, sessionId);
      await tx.couponRedemption.updateMany({ where: { ...scope, status: "applied" }, data: { status: "cancelled" } });
      await repo.saveSessionIfUnchanged(next, current);
      return (await repo.getSession(merchantId, sessionId))!;
    };
    return this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work);
  }

  async saveBenefitsIfMutable(session: CheckoutSession, expected: CheckoutSession, authorizedRules: MerchantRules): Promise<CheckoutSession> {
    assertNoUnprojectedWidgetReceipt(session.cart);
    assertNoUnprojectedWidgetReceipt(expected.cart);
    assertNoCheckoutCouponBindingInput(session.cart);
    assertNoCheckoutCouponBindingInput(expected.cart);
    const work = async (tx: Prisma.TransactionClient) => {
      const { merchantId, sessionId } = expected;
      // Payment admission takes this same merchant lock before validating the quote.
      await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id = ${merchantId} FOR UPDATE`;
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId} AND session_id = ${sessionId} FOR UPDATE`;
      const stored = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } }, select: { cart: true } });
      assertNoUnprojectedWidgetReceipt(stored?.cart);
      assertNoCheckoutCouponBindingInput(stored?.cart);
      const repo = new PrismaCheckoutRepository(tx, true, this.orderQuota);
      const current = await repo.getSession(merchantId, sessionId);
      if (!current) throw new ConflictException("CHECKOUT_SESSION_NOT_FOUND");
      const scope = { merchantId, sessionId };
      if (await tx.paymentIntent.findFirst({ where: { ...scope, status: { notIn: ["failed", "cancelled"] } }, select: { id: true } })
        || await tx.completedOrder.findFirst({ where: scope, select: { id: true } })
        || await tx.strategyIncentiveAssignment.findUnique({ where: { merchantId_sessionId: scope }, select: { id: true } })) {
        return current;
      }
      const currentRules = await repo.getRules(merchantId);
      if (Object.entries(currentRules).some(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(authorizedRules[key as keyof MerchantRules]))) {
        throw new ConflictException("CHECKOUT_BENEFITS_RULES_CHANGED");
      }
      await repo.saveSessionIfUnchanged(session, expected);
      return session;
    };
    return this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work);
  }

  async createSessionIfAbsent(session: CheckoutSession): Promise<{ session: CheckoutSession; created: boolean }> {
    assertNoUnprojectedWidgetReceipt(session.cart);
    assertNoCheckoutCouponBindingInput(session.cart);
    session = structuredClone(session);
    if (strategyExecutionEnabled(session.merchantId) || incentiveExecutionEnabled(session.merchantId)) {
      const create = async (tx: Prisma.TransactionClient) => {
        // The store lock orders activation, creation, enrollment and stopping.
        // Timestamp AFTER taking it, so concurrent starts cannot backdate the
        // first eligible session or enroll a buyer from a later session.
        await lockExecutionMerchant(tx, session.merchantId);
        await lockCheckoutSessionAnchor(tx, session.merchantId, session.sessionId);
        const previous = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: {
          merchantId: session.merchantId, sessionId: session.sessionId } } });
        if (previous) return { session: toCheckoutSession(previous), created: false };
        const now = await executionClock(tx);
        const row = await tx.checkoutSession.create({ data: { ...toCheckoutSessionCreate(session), createdAt: now, updatedAt: now } as any });
        await enrollCreatedStrategySession(tx, row, now);
        const incentive = await applyEligibleIncentive(tx, row);
        return { session: toCheckoutSession(incentive), created: true };
      };
      return this.inTransaction ? create(this.prisma) : (this.prisma as PrismaClient).$transaction(create);
    }
    const create = async (tx: Prisma.TransactionClient) => {
      await lockCheckoutSessionAnchor(tx, session.merchantId, session.sessionId);
      const where = { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } };
      const previous = await tx.checkoutSession.findUnique({ where });
      if (previous) return { session: toCheckoutSession(previous), created: false };
      const row = await tx.checkoutSession.upsert({ where,
        create: toCheckoutSessionCreate(session) as any, update: {} });
      return { session: toCheckoutSession(row), created: row.conversationId === session.conversationId };
    };
    try {
      return await (this.inTransaction ? create(this.prisma) : (this.prisma as PrismaClient).$transaction(create));
    } catch (error) {
      // An emulated Prisma upsert can lose a concurrent insert; reread its winner.
      // A failed outer transaction must be handled by its owner, not queried again.
      if (this.inTransaction || (error as { code?: string })?.code !== "P2002") throw error;
      const existing = await this.getSession(session.merchantId, session.sessionId);
      if (!existing) throw error;
      return { session: existing, created: false };
    }
  }

  async getSession(merchantId: string, sessionId: string): Promise<CheckoutSession | undefined> {
    const row = await this.prisma.checkoutSession.findUnique({
      where: { merchantId_sessionId: { merchantId, sessionId } }
    });
    return row ? toCheckoutSession(row) : undefined;
  }

  async findSessionsByEmail(merchantId: string, email: string): Promise<CheckoutSession[]> {
    // P2: customer email lives in a JSON column — filter is pushed to Prisma's JSON
    // path query rather than loading all rows into memory.
    // NOTE: full DB-level index on customerEmail requires a denormalized column in
    // the schema (blocked — schema is owned by a prior phase). This is the best
    // achievable without schema migration.
    const normalizedEmail = email.toLowerCase().trim();
    const rows = await this.prisma.checkoutSession.findMany({
      where: {
        merchantId,
        customer: {
          path: ["email"],
          string_contains: normalizedEmail
        }
      }
    });
    // Secondary in-process filter to enforce exact match (path string_contains is a substring search).
    return rows
      .map(toCheckoutSession)
      .filter((s) => s.customer?.email?.toLowerCase().trim() === normalizedEmail);
  }

  async findSessionsWithTrigger(threshold = 0.55): Promise<CheckoutSession[]> {
    // Cart Recovery scanner targets recently-triggered sessions. 72h window gives
    // abandoned carts a realistic chance to be recovered (buyer may return next day).
    const RECOVERY_WINDOW_HOURS = 72;
    const twentyFourHoursAgo = new Date(Date.now() - RECOVERY_WINDOW_HOURS * 60 * 60 * 1000);
    const rows = await this.prisma.checkoutSession.findMany({
      where: {
        triggerAgent: true,
        abandonmentScore: { gte: threshold },
        updatedAt: { gte: twentyFourHoursAgo }
      },
      take: 100,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map(toCheckoutSession);
  }

  async recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName, metadata?: Record<string, unknown>): Promise<void> {
    if (!event) return; // Guard: missing event name should not 500
    const write = async (tx: Prisma.TransactionClient) => {
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId}
        AND session_id = ${sessionId} FOR UPDATE`;
      const session = await tx.checkoutSession.findUnique({
        where: { merchantId_sessionId: { merchantId, sessionId } }
      });
      await tx.checkoutEvent.create({
        data: { merchantId, sessionId, eventName: event, occurredAt: new Date(), metadata: metadata as any }
      });
      if (!session) return;
      const score = CheckoutAbandonmentService.applyEvent(session.abandonmentScore, event);
      // Idle and terminal abandonment events describe time that has already
      // elapsed; they must not reset the last-real-activity clock that Cart
      // Recovery uses for its five-minute quiet-period check.
      const preservesLastActivity = event === "idle_30_seconds" || event === "checkout_abandoned";
      await tx.checkoutSession.update({
        where: { merchantId_sessionId: { merchantId, sessionId } },
        data: {
          abandonmentScore: score.nextScore,
          triggerAgent: score.triggerAgent,
          ...(preservesLastActivity ? {} : { updatedAt: new Date() })
        }
      });
    };
    if (this.inTransaction) await write(this.prisma);
    else await (this.prisma as PrismaClient).$transaction(write);
  }

  async getSessionEvents(merchantId: string, sessionId: string): Promise<CheckoutEventName[]> {
    const rows = await this.prisma.checkoutEvent.findMany({
      where: { merchantId, sessionId },
      orderBy: { occurredAt: "asc" },
      select: { eventName: true }
    });
    return rows.map((r) => r.eventName as CheckoutEventName);
  }

  async appendChatTurn(merchantId: string, sessionId: string, turn: ChatTurn): Promise<CheckoutSession> {
    turn = structuredClone(turn);
    const write = async (tx: Prisma.TransactionClient) => {
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId}
        AND session_id = ${sessionId} FOR UPDATE`;
      const currentRow = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
      const current = currentRow ? toCheckoutSession(currentRow) : undefined;
      if (!current) throw new Error("checkout_session_not_found");
      const next = [...current.chatHistory, turn].slice(-50);

      // The database counter also detects two updates within the same millisecond.
      const result = await tx.checkoutSession.updateMany({
        where: {
          merchantId,
          sessionId,
          version: current.persistenceVersion
        },
        data: {
          chatHistory: next as unknown as Prisma.InputJsonValue,
          updatedAt: new Date()
        }
      });

      if (result.count === 0) {
        throw new Error("session_conflict_concurrent_update");
      }

      // Re-fetch to return current state (mirrors last-write semantic but safely locked).
      const updated = await tx.checkoutSession.findUnique({
        where: { merchantId_sessionId: { merchantId, sessionId } }
      });
      if (!updated) throw new Error("checkout_session_not_found");
      return toCheckoutSession(updated);
    };
    return this.inTransaction ? write(this.prisma) : (this.prisma as PrismaClient).$transaction(write);
  }

  /** The pair and its proof commit together. No external I/O inside this transaction. */
  async appendChatExchange(input: ChatExchangeInput): Promise<CheckoutSession> {
    assertNoUnprojectedWidgetReceipt(input.expectedSession?.cart);
    input = structuredClone(input);
    if (input.buyer.role !== "buyer" || input.agent.role !== "agent"
      || typeof input.buyer.text !== "string" || typeof input.agent.text !== "string") throw new Error("CHAT_EXCHANGE_INVALID");
    const write = async (tx: Prisma.TransactionClient) => {
      await lockCheckoutSessionAnchor(tx, input.merchantId, input.sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${input.merchantId}
        AND session_id = ${input.sessionId} FOR UPDATE`;
      const where = { merchantId_sessionId: { merchantId: input.merchantId, sessionId: input.sessionId } };
      const row = await tx.checkoutSession.findUnique({ where });
      if (!row) throw new Error("checkout_session_not_found");
      assertNoUnprojectedWidgetReceipt(row.cart);
      if (input.selectedPaymentMethod !== undefined && (deriveChatStage(toCheckoutSession(row)) !== "payment"
        || !["pix", "credit_card", "boleto", "crypto"].includes(input.selectedPaymentMethod))) {
        throw new Error("CHAT_PAYMENT_SELECTION_CONFLICT");
      }
      if (input.claim) {
        const request = await tx.checkoutChatRequest.findFirst({ where: { id: input.claim.requestId,
          merchantId: input.merchantId, sessionId: input.sessionId, requestHash: input.claim.requestHash,
          conversationId: row.conversationId, status: "processing", protocolVersion: 2 }, include: { exchange: true } });
        if (!request || request.exchange || request.buyerMessageHash !== chatMessageTextHash(input.buyer.text)) {
          throw new Error("CHAT_EXCHANGE_CLAIM_CONFLICT");
        }
        // Compare persisted domain values. Strategy publication still requires its
        // stronger admission revision/baseline/consent checks at the effect boundary.
        const hash = (session: CheckoutSession) => digest(JSON.parse(JSON.stringify(toCheckoutSessionCreate(session))));
        if (!input.expectedSession || input.expectedSession.persistenceVersion !== row.version
          || hash(input.expectedSession) !== hash(toCheckoutSession(row))) {
          throw new Error("CHAT_EXCHANGE_SESSION_CHANGED");
        }
      }
      const now = await executionClock(tx);
      const pair = [input.buyer, input.agent].map(turn => ({ role: turn.role, text: turn.text,
        occurredAt: now.toISOString(), ...(turn.authorizedOfferId ? { authorizedOfferId: turn.authorizedOfferId } : {}),
        ...(input.claim ? { chatRequestId: input.claim.requestId } : {}) }));
      if (!Array.isArray(row.chatHistory)) throw new Error("CHAT_EXCHANGE_INVALID_HISTORY");
      const updated = await tx.checkoutSession.update({ where,
        data: { chatHistory: [...row.chatHistory, ...pair].slice(-50) as Prisma.InputJsonValue, updatedAt: now,
          ...(input.selectedPaymentMethod ? { paymentMethod: input.selectedPaymentMethod } : {}) } });
      if (input.claim) {
        // PostgreSQL JSONB text is the canonical representation for this evidence;
        // the insert trigger independently verifies it against the persisted pair.
        const [proof] = await tx.$queryRaw<Array<{ hash: string }>>`SELECT
          encode(sha256(convert_to(jsonb_build_array(chat_history -> -2, chat_history -> -1)::text, 'UTF8')), 'hex') AS hash
          FROM checkout_sessions WHERE merchant_id = ${input.merchantId} AND session_id = ${input.sessionId}`;
        let paymentProof = {};
        if (input.selectedPaymentMethod && chatPaymentRecoveryEnabled(input.merchantId)) {
          const [context] = await tx.$queryRaw<Array<{ hash: string }>>`SELECT checkout_chat_payment_context_hash(s) AS hash
            FROM checkout_sessions s WHERE merchant_id = ${input.merchantId} AND session_id = ${input.sessionId}`;
          paymentProof = { paymentMethod: input.selectedPaymentMethod, paymentCartHash: paymentCartFingerprint(toCheckoutSession(updated)),
            paymentContextHash: context.hash };
        }
        await tx.checkoutChatExchange.create({ data: { requestId: input.claim.requestId, merchantId: input.merchantId,
          sessionId: input.sessionId, exchangeHash: proof.hash, recordedAt: now, ...paymentProof } });
      }
      return toCheckoutSession(updated);
    };
    return this.inTransaction ? write(this.prisma) : (this.prisma as PrismaClient).$transaction(write);
  }

  async saveOffer(offer: AuthorizedOffer): Promise<AuthorizedOffer> {
    const row = await this.prisma.authorizedOffer.upsert({
      where: { id: offer.id },
      create: toAuthorizedOfferCreate(offer),
      update: toAuthorizedOfferUpdate(offer)
    });
    return toAuthorizedOffer(row);
  }

  async getOffer(merchantId: string, offerId: string): Promise<AuthorizedOffer | undefined> {
    const row = await this.prisma.authorizedOffer.findFirst({ where: { id: offerId, merchantId } });
    return row ? toAuthorizedOffer(row) : undefined;
  }

  async saveAcceptedOffer(acceptedOffer: AcceptedOffer): Promise<void> {
    await this.prisma.acceptedOffer.upsert({
      where: {
        merchantId_sessionId_offerId: {
          merchantId: acceptedOffer.merchantId,
          sessionId: acceptedOffer.sessionId,
          offerId: acceptedOffer.offerId
        }
      },
      create: toAcceptedOfferCreate(acceptedOffer),
      update: {}
    });
  }

  async getAcceptedOffer(merchantId: string, sessionId: string, offerId: string): Promise<AcceptedOffer | undefined> {
    const row = await this.prisma.acceptedOffer.findUnique({
      where: { merchantId_sessionId_offerId: { merchantId, sessionId, offerId } }
    });
    return row ? toAcceptedOffer(row) : undefined;
  }

  async saveCompletedOrder(order: CompletedOrder): Promise<{ order: CompletedOrder; idempotent: boolean }> {
    if (!this.inTransaction) return this.transaction(async (repository) => repository.saveCompletedOrder(order));
    // ON CONFLICT keeps the surrounding order/outbox transaction usable when a
    // concurrent delivery wins. Catching a unique violation would leave PostgreSQL aborted.
    const inserted = await this.prisma.completedOrder.createMany({
      data: [toCompletedOrderCreate(order)], skipDuplicates: true,
    });
    const saved = await this.getCompletedOrder(order.merchantId, order.sessionId, order.externalOrderId);
    if (!saved) throw new Error("completed_order_persistence_failed");
    if (saved.orderTotal !== order.orderTotal || saved.currency !== order.currency || saved.acceptedOfferId !== order.acceptedOfferId) {
      throw new Error("completed_order_idempotency_conflict");
    }
    if (inserted.count === 1) {
      const persisted = await this.prisma.completedOrder.findUniqueOrThrow({ where: { merchantId_sessionId_externalOrderId: { merchantId: order.merchantId, sessionId: order.sessionId, externalOrderId: order.externalOrderId } } });
      await createDigitalOrderFulfillment(this.prisma as Prisma.TransactionClient, persisted.id, order.merchantId);
      await initializeOrderFulfillment(this.prisma as Prisma.TransactionClient, persisted.id, order.merchantId);
    }
    return { order: saved, idempotent: inserted.count === 0 };
  }

  async recordCompletedOrderQuota(order: CompletedOrder): Promise<void> {
    await this.orderQuota?.recordCompletedOrder({
      merchantId: order.merchantId,
      externalOrderId: order.externalOrderId,
      completedAt: new Date(order.completedAt),
    }, this.prisma as Prisma.TransactionClient);
  }

  async getCompletedOrder(merchantId: string, sessionId: string, externalOrderId: string): Promise<CompletedOrder | undefined> {
    const row = await this.prisma.completedOrder.findUnique({
      where: { merchantId_sessionId_externalOrderId: { merchantId, sessionId, externalOrderId } }
    });
    return row ? toCompletedOrder(row) : undefined;
  }

  async findCompletedOrderById(merchantId: string, orderId: string): Promise<CompletedOrder | undefined> {
    const row = await this.prisma.completedOrder.findFirst({ where: { merchantId, id: orderId } });
    return row ? toCompletedOrder(row) : undefined;
  }


  async findCompletedOrderByExternalOrderId(merchantId: string, externalOrderId: string): Promise<CompletedOrder | undefined> {
    const row = await this.prisma.completedOrder.findFirst({
      where: { merchantId, externalOrderId },
      orderBy: { completedAt: "desc" }
    });
    return row ? toCompletedOrder(row) : undefined;
  }

  async updateCompletedOrderTracking(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    trackingCode: string;
  }): Promise<CompletedOrder | undefined> {
    try {
      const row = await this.prisma.completedOrder.update({
        where: {
          merchantId_sessionId_externalOrderId: {
            merchantId: input.merchantId,
            sessionId: input.sessionId,
            externalOrderId: input.externalOrderId
          }
        },
        data: { trackingCode: input.trackingCode }
      });
      return toCompletedOrder(row);
    } catch (error) {
      if (isPrismaRecordNotFound(error)) return undefined;
      throw error;
    }
  }

  async updateCompletedOrderStatus(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    status: CompletedOrderStatus;
  }): Promise<CompletedOrder | undefined> {
    try {
      const row = await this.prisma.completedOrder.update({
        where: {
          merchantId_sessionId_externalOrderId: {
            merchantId: input.merchantId,
            sessionId: input.sessionId,
            externalOrderId: input.externalOrderId
          }
        },
        data: { status: input.status }
      });
      return toCompletedOrder(row);
    } catch (error) {
      if (isPrismaRecordNotFound(error)) return undefined;
      throw error;
    }
  }

  async cancelCompletedOrder(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    reason: string;
    cancelledAt: string;
  }): Promise<{ order: CompletedOrder; idempotent: boolean } | undefined> {
    const existing = await this.getCompletedOrder(
      input.merchantId,
      input.sessionId,
      input.externalOrderId,
    );
    if (!existing) return undefined;
    if (existing.status === "cancelled") {
      return { order: existing, idempotent: true };
    }
    try {
      const result = await this.prisma.completedOrder.updateMany({
        where: {
          merchantId: input.merchantId,
          sessionId: input.sessionId,
          externalOrderId: input.externalOrderId,
          status: { not: "cancelled" },
        },
        data: {
          status: "cancelled",
          cancelledAt: new Date(input.cancelledAt),
          cancellationReason: input.reason,
        },
      });
      const order = await this.getCompletedOrder(
        input.merchantId,
        input.sessionId,
        input.externalOrderId,
      );
      return order
        ? { order, idempotent: result.count === 0 }
        : undefined;
    } catch (error) {
      if (isPrismaRecordNotFound(error)) return undefined;
      throw error;
    }
  }

  async appendOutbox(event: DomainEventEnvelope): Promise<DomainEventEnvelope> {
    await this.prisma.outboxMessage.upsert({
      where: { eventId: event.event_id },
      create: {
        eventId: event.event_id,
        eventType: event.event_type,
        schemaVersion: event.schema_version,
        merchantId: event.merchant_id,
        occurredAt: new Date(event.occurred_at),
        correlationId: event.correlation_id,
        causationId: event.causation_id,
        producer: event.producer,
        payload: event.payload as Prisma.InputJsonValue
      },
      update: {}
    });
    return event;
  }

  async listOutbox(merchantId: string): Promise<DomainEventEnvelope[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { merchantId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => ({
      event_id: row.eventId,
      event_type: row.eventType as DomainEventEnvelope["event_type"],
      schema_version: 1,
      merchant_id: row.merchantId,
      occurred_at: row.occurredAt.toISOString(),
      correlation_id: row.correlationId,
      causation_id: row.causationId,
      producer: "checkout",
      payload: row.payload as Record<string, unknown>
    }));
  }

  async listPending(batchSize = 50): Promise<DomainEventEnvelope[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: batchSize
    });
    return rows.map((row) => ({
      event_id: row.eventId,
      event_type: row.eventType as DomainEventEnvelope["event_type"],
      schema_version: 1,
      merchant_id: row.merchantId,
      occurred_at: row.occurredAt.toISOString(),
      correlation_id: row.correlationId,
      causation_id: row.causationId,
      producer: "checkout",
      payload: row.payload as Record<string, unknown>
    }));
  }

  async claimBatch(_batchSize = 50): Promise<{ envelope: DomainEventEnvelope; attempts: number }[]> {
    throw new Error("outbox_dispatcher_repository_required");
  }

  async markDelivered(_eventId: string): Promise<void> {
    throw new Error("outbox_claim_required");
  }

  async markFailed(_eventId: string, _error?: string): Promise<void> {
    throw new Error("outbox_claim_required");
  }

  async recordFailure(
    _eventId: string,
    _error: string,
    _backoff: { maxAttempts: number; nextAttemptAt: Date }
  ): Promise<{ attempts: number; dead: boolean }> {
    throw new Error("outbox_claim_required");
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const row = await this.prisma.outboxMessage.findUnique({
      where: { eventId },
      select: { status: true }
    });
    return row?.status === "delivered";
  }

  async isHandlerProcessed(eventId: string, handlerId: string): Promise<boolean> {
    const row = await this.prisma.outboxHandlerExecution.findUnique({
      where: { eventId_handlerId: { eventId, handlerId } },
      select: { eventId: true }
    });
    return row !== null;
  }

  async markHandlerProcessed(_eventId: string, _handlerId: string): Promise<void> {
    throw new Error("outbox_claim_required");
  }

  async overview(merchantId: string, period: StorePeriod): Promise<DashboardOverview> {
    const { from, to } = resolveOverviewDateRange(period);
    const dateRange = { gte: from, lte: to };
    // Funnel stages are session metrics. A client retry can insert the same stage
    // more than once, so each stage must count a checkout session only once.
    const [
      sessions,
      offers,
      conversationsStarted,
      offersViewed,
      ordersCompleted,
      offersAccepted,
      avgDiscountResult,
      avgShippingResult,
      avgCartResult
    ] = await Promise.all([
      this.prisma.checkoutSession.findMany({ where: { merchantId, createdAt: dateRange }, orderBy: { createdAt: "desc" }, take: 10 }),
      this.prisma.authorizedOffer.findMany({ where: { merchantId, session: { createdAt: dateRange } }, orderBy: { expiresAt: "desc" }, take: 10 }),
      this.prisma.checkoutSession.count({ where: { merchantId, createdAt: dateRange } }),
      this.prisma.checkoutEvent.findMany({
        where: { merchantId, eventName: "offer_viewed", occurredAt: dateRange },
        distinct: ["sessionId"],
        select: { sessionId: true }
      }),
      this.prisma.checkoutEvent.findMany({
        where: { merchantId, eventName: "order_completed", occurredAt: dateRange },
        distinct: ["sessionId"],
        select: { sessionId: true }
      }),
      this.prisma.checkoutEvent.findMany({
        where: { merchantId, eventName: "offer_accepted", occurredAt: dateRange },
        distinct: ["sessionId"],
        select: { sessionId: true }
      }),
      this.prisma.acceptedOffer.aggregate({ where: { merchantId, acceptedAt: dateRange, type: "discount_percent" }, _avg: { value: true } }),
      this.prisma.acceptedOffer.aggregate({ where: { merchantId, acceptedAt: dateRange, type: { startsWith: "shipping" } }, _avg: { value: true } }),
      this.prisma.checkoutSession.aggregate({ where: { merchantId, createdAt: dateRange }, _avg: { abandonmentScore: true } })
    ]);
    // incremental_revenue: completed orders × average authorized offer value (best approximation without order table join)
    const avgCartValue = (avgCartResult._avg as Record<string, number | null>).abandonmentScore ?? 0;
    void avgCartValue; // not used directly; kept for future extension
    // Use recent sessions cart total as proxy for average cart value
    const recentTotals = sessions.map((s) => ((s.cart as unknown as Cart).total ?? 0));
    const avgCart = recentTotals.length
      ? recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length
      : 0;
    return {
      merchant_id: merchantId,
      conversations_started: conversationsStarted,
      offers_viewed: offersViewed.length,
      offers_accepted: offersAccepted.length,
      orders_completed: ordersCompleted.length,
      conversion_rate_with_agent: conversationsStarted ? ordersCompleted.length / conversationsStarted : 0,
      average_discount: toNumber(avgDiscountResult._avg.value),
      average_shipping_subsidy: toNumber(avgShippingResult._avg.value),
      incremental_revenue: ordersCompleted.length * avgCart,
      recent_sessions: sessions.map(toCheckoutSession),
      recent_offers: offers.map(toAuthorizedOffer)
    };
  }
}

function resolveOverviewDateRange(period: StorePeriod): { from: Date; to: Date } {
  const { from, to } = resolveBusinessPeriod(period);
  return { from, to };
}

function toCheckoutSessionCreate(session: CheckoutSession) {
  return {
    merchantId: session.merchantId,
    sessionId: session.sessionId,
    globalUserId: session.globalUserId,
    conversationId: session.conversationId,
    cart: session.cart as unknown as Prisma.InputJsonValue,
    customer: (session.customer ?? undefined) as unknown as Prisma.InputJsonValue,
    shipping: (session.shipping ?? undefined) as unknown as Prisma.InputJsonValue,
    shippingOptions: (session.shippingOptions ?? undefined) as unknown as Prisma.InputJsonValue,
    abandonmentScore: session.abandonmentScore,
    triggerAgent: session.triggerAgent,
    chatHistory: (session.chatHistory ?? []) as unknown as Prisma.InputJsonValue,
    paymentMethod: session.paymentMethod ?? null,
    promptVariantId: session.promptVariantId ?? null,
    cohort: session.cohort ?? null,
    featuresApplied: (session.featuresApplied ?? undefined) as unknown as Prisma.InputJsonValue,
    aiCostCents: session.aiCostCents ?? 0,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt)
  };
}

function toCheckoutSessionUpdate(session: CheckoutSession) {
  return {
    globalUserId: session.globalUserId,
    conversationId: session.conversationId,
    cart: session.cart as unknown as Prisma.InputJsonValue,
    customer: (session.customer ?? undefined) as unknown as Prisma.InputJsonValue,
    // undefined means "skip update" in Prisma, leaving a stale delivery quote.
    // A full checkout snapshot without shipping explicitly revokes that quote.
    shipping: session.shipping ? toCheckoutShippingJson(session.shipping) : Prisma.DbNull,
    shippingOptions: session.shippingOptions?.map(toCheckoutShippingJson) ?? Prisma.DbNull,
    abandonmentScore: session.abandonmentScore,
    triggerAgent: session.triggerAgent,
    chatHistory: (session.chatHistory ?? []) as unknown as Prisma.InputJsonValue,
    paymentMethod: session.paymentMethod ?? null,
    promptVariantId: session.promptVariantId ?? null,
    cohort: session.cohort ?? null,
    featuresApplied: (session.featuresApplied ?? undefined) as unknown as Prisma.InputJsonValue,
    aiCostCents: session.aiCostCents ?? 0,
    updatedAt: new Date(session.updatedAt)
  };
}

function toAuthorizedOfferCreate(offer: AuthorizedOffer) {
  return {
    id: offer.id,
    merchantId: offer.merchantId,
    sessionId: offer.sessionId,
    type: offer.type,
    value: offer.value,
    approved: offer.approved,
    reason: offer.reason,
    marginAfterOffer: offer.marginAfterOffer,
    expiresAt: new Date(offer.expiresAt),
    discountCode: offer.discountCode
  };
}

function toAuthorizedOfferUpdate(offer: AuthorizedOffer) {
  return {
    type: offer.type,
    value: offer.value,
    approved: offer.approved,
    reason: offer.reason,
    marginAfterOffer: offer.marginAfterOffer,
    expiresAt: new Date(offer.expiresAt),
    discountCode: offer.discountCode
  };
}

function toAuthorizedOffer(row: {
  id: string;
  merchantId: string;
  sessionId: string;
  type: string;
  value: DecimalLike;
  approved: boolean;
  reason: string;
  marginAfterOffer: DecimalLike;
  expiresAt: Date;
  discountCode: string | null;
}): AuthorizedOffer {
  return {
    id: row.id,
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    type: row.type as OfferType,
    value: toNumber(row.value),
    approved: row.approved,
    reason: row.reason,
    marginAfterOffer: toNumber(row.marginAfterOffer),
    expiresAt: row.expiresAt.toISOString(),
    discountCode: row.discountCode ?? undefined
  };
}

function toAcceptedOfferCreate(offer: AcceptedOffer) {
  return {
    merchantId: offer.merchantId,
    sessionId: offer.sessionId,
    offerId: offer.offerId,
    type: offer.type,
    value: offer.value,
    marginAfterOffer: offer.marginAfterOffer,
    acceptedAt: new Date(offer.acceptedAt),
    expiresAt: new Date(offer.expiresAt)
  };
}

function toAcceptedOffer(row: {
  merchantId: string;
  sessionId: string;
  offerId: string;
  type: string;
  value: DecimalLike;
  marginAfterOffer: DecimalLike;
  acceptedAt: Date;
  expiresAt: Date;
}): AcceptedOffer {
  return {
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    offerId: row.offerId,
    type: row.type as OfferType,
    value: toNumber(row.value),
    marginAfterOffer: toNumber(row.marginAfterOffer),
    acceptedAt: row.acceptedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString()
  };
}

function toCompletedOrderCreate(order: CompletedOrder) {
  return {
    merchantId: order.merchantId,
    sessionId: order.sessionId,
    externalOrderId: order.externalOrderId,
    orderTotal: order.orderTotal,
    currency: order.currency,
    status: order.status ?? "approved",
    acceptedOfferId: order.acceptedOfferId,
    trackingCode: order.trackingCode,
    lineItemsJson: order.lineItems ? (order.lineItems as unknown as object) : undefined,
    shippingCents: order.shippingCents,
    completedAt: new Date(order.completedAt),
    cancelledAt: order.cancelledAt
      ? new Date(order.cancelledAt)
      : undefined,
    cancellationReason: order.cancellationReason,
  };
}

function toCompletedOrder(row: {
  merchantId: string;
  sessionId: string;
  externalOrderId: string;
  orderTotal: DecimalLike;
  currency: string;
  status?: string;
  acceptedOfferId: string | null;
  trackingCode?: string | null;
  lineItemsJson?: unknown;
  shippingCents?: number | null;
  completedAt: Date;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
}): CompletedOrder {
  return {
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    externalOrderId: row.externalOrderId,
    orderTotal: toNumber(row.orderTotal),
    currency: row.currency as CurrencyCode,
    status: row.status as CompletedOrderStatus,
    acceptedOfferId: row.acceptedOfferId ?? undefined,
    trackingCode: row.trackingCode ?? undefined,
    lineItems: Array.isArray(row.lineItemsJson)
      ? (row.lineItemsJson as CompletedOrder["lineItems"])
      : undefined,
    shippingCents: row.shippingCents ?? undefined,
    completedAt: row.completedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString(),
    cancellationReason: row.cancellationReason ?? undefined,
  };
}

function toMerchantRuleCreate(merchantId: string, rules: MerchantRules) {
  return { merchantId, ...toMerchantRuleUpdate(rules) };
}

function toMerchantRuleUpdate(rules: MerchantRules) {
  return {
    maxDiscountPercent: rules.maxDiscountPercent,
    minimumMarginPercent: rules.minimumMarginPercent,
    allowFreeShipping: rules.allowFreeShipping,
    allowShippingDiscount: rules.allowShippingDiscount,
    allowBonusItem: rules.allowBonusItem,
    allowStackDiscountAndFreeShipping: rules.allowStackDiscountAndFreeShipping,
    couponBoxEnabled: rules.couponBoxEnabled,
    freeShippingMinCartValue: rules.freeShippingMinCartValue,
    maxShippingSubsidy: rules.maxShippingSubsidy,
    maxPartialShippingDiscount: rules.maxPartialShippingDiscount,
    offerExpirationMinutes: rules.offerExpirationMinutes,
    blockedRegions: rules.blockedRegions,
    brandVoice: rules.brandVoice
  };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function isPrismaRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2025"
  );
}
