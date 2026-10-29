import { assertMarketplacePublicPaymentPolicy, assertMarketplacePublicPaymentCheckout } from "../application/marketplace-public-payment-admission.service.js";
import { hasMarketplaceCheckout } from "../../checkout/infrastructure/marketplace-checkout-scope.js";
import { freezeMarketplaceFunding, fundingHash } from "../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { ServiceUnavailableException } from "@nestjs/common";
import { snapshotDigitalPaymentContent } from "../../../shared/persistence/digital-payment-content.js";
import { Injectable } from "@nestjs/common";
import { ConflictException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { assertSamePaymentIdentity, PaymentIntentConflictError } from "../domain/payment-persistence.js";
import { readPaymentCouponAuthority } from "../domain/payment-coupon-authority.js";
import { readPaymentWidgetCheckoutAuthority, assertSamePaymentWidgetCheckoutAuthority } from "../domain/payment-widget-checkout-authority.js";
import type { CaptureWidgetCheckoutPayment } from "./prisma-widget-checkout-payment-admission.js";
import { lockCheckoutSessionAnchor } from "../../../shared/persistence/checkout-session-lock.js";
import type {
  CryptoTransferKey,
  PaymentRepository,
  ProviderEventKey,
  SavePaymentIntentInput,
  SavePaymentIntentWithSettlementPlanInput,
  StalePendingQuery
} from "../domain/ports/payment-repository.port.js";
import type { PaymentIntentSnapshot, PaymentIntentStatus } from "../domain/payment-intent.entity.js";
import type { PaymentMethod } from "../domain/payment-intent.entity.js";
import { appendPlannedSettlementInTransaction } from "./prisma-payment-settlement-ledger.repository.js";
import { recordIncentivePayment, validateIncentivePayment } from "../../revenue-manager/infrastructure/incentive-execution-ledger.js";
import { assertNoCheckoutCouponBindingInput } from "../../checkout/domain/services/checkout-coupon-storage.js";
import { assertNoUnprojectedWidgetReceipt } from "../../checkout/domain/services/checkout-widget-receipt-boundary.js";
import { parseStorefrontCouponPaymentScope, type StorefrontCouponPaymentScope } from "../domain/storefront-coupon-payment-scope.js";
import { assertNeighborhoodPaymentAdmission } from "./prisma-payment-neighborhood-admission.js";
import { readPaymentNormalCrossSellAuthority, assertSamePaymentNormalCrossSellAuthority } from "../domain/payment-normal-cross-sell-authority.js";
import type { CaptureNormalCrossSellPayment } from "./prisma-normal-cross-sell-payment-admission.js";

type PrismaTx = Prisma.TransactionClient;

function paymentIntentUpsertArgs(d: PaymentIntentSnapshot) {
  const s = strip(d);
  const createData = {
    version: (d.version ?? 0) + 1,
    amountBreakdown: d.amountBreakdown ? d.amountBreakdown as Prisma.InputJsonValue : Prisma.DbNull,
    creation: d.creation ? d.creation as unknown as Prisma.InputJsonValue : Prisma.DbNull,
    id: d.id,
    merchantId: s.merchantId,
    sessionId: s.sessionId,
    idempotencyKey: s.idempotencyKey,
    amountCents: d.amountCents,
    currency: d.currency,
    method: d.method,
    status: d.status,
    providerPaymentId: d.providerPaymentId ?? null,
    approvedAmountCents: d.approvedAmountCents ?? null,
    acceptedOfferId: d.acceptedOfferId ?? null,
    commerceOrderId: d.commerceOrderId ?? null,
    buyerFacing: d.buyerFacing ? (d.buyerFacing as Prisma.InputJsonValue) : Prisma.DbNull,
    statusHistory: d.statusHistory as unknown as Prisma.InputJsonValue
  };
  const updateData = {
    version: (d.version ?? 0) + 1,
    creation: d.creation ? d.creation as unknown as Prisma.InputJsonValue : Prisma.DbNull,
    status: d.status,
    providerPaymentId: d.providerPaymentId ?? null,
    approvedAmountCents: d.approvedAmountCents ?? null,
    acceptedOfferId: d.acceptedOfferId ?? null,
    commerceOrderId: d.commerceOrderId ?? null,
    buyerFacing: d.buyerFacing ? (d.buyerFacing as Prisma.InputJsonValue) : Prisma.DbNull,
    statusHistory: d.statusHistory as unknown as Prisma.InputJsonValue,
    currency: d.currency,
    method: d.method,
    amountCents: d.amountCents
  };
  return {
    where: { merchantId_sessionId_idempotencyKey: s },
    create: createData as any,
    update: updateData as any
  };
}

function outboxUpsertArgs(event: DomainEventEnvelope) {
  return {
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
  };
}

function strip(d: PaymentIntentSnapshot) {
  return {
    merchantId: d.merchantId.trim(),
    sessionId: d.sessionId.trim(),
    idempotencyKey: d.idempotencyKey.trim()
  };
}

type NormalizedCryptoTransfer = NonNullable<NonNullable<PaymentIntentSnapshot["buyerFacing"]>["transfers"]>[number];

export function normalizeBuyerFacing(v: unknown): PaymentIntentSnapshot["buyerFacing"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const rec = v as Record<string, unknown>;
  const out: PaymentIntentSnapshot["buyerFacing"] = {};
  if (typeof rec.qrCodeCopyPaste === "string") out.qrCodeCopyPaste = rec.qrCodeCopyPaste;
  if (typeof rec.invoiceUrl === "string") out.invoiceUrl = rec.invoiceUrl;
  if (typeof rec.encodedQrImage === "string") out.encodedQrImage = rec.encodedQrImage;
  if (typeof rec.clientSecret === "string") out.clientSecret = rec.clientSecret;
  if (typeof rec.stripePublishableKey === "string") out.stripePublishableKey = rec.stripePublishableKey;
  if (typeof rec.chainId === "number") out.chainId = rec.chainId;
  if (typeof rec.chain === "string") out.chain = rec.chain;
  if (typeof rec.evmNetwork === "string") out.evmNetwork = rec.evmNetwork;
  if (typeof rec.chainLabel === "string") out.chainLabel = rec.chainLabel;
  if (typeof rec.tokenAddress === "string") out.tokenAddress = rec.tokenAddress;
  if (typeof rec.tokenSymbol === "string") out.tokenSymbol = rec.tokenSymbol;
  if (typeof rec.amountAtomic === "string") out.amountAtomic = rec.amountAtomic;
  if (typeof rec.amountDisplay === "string") out.amountDisplay = rec.amountDisplay;
  if (typeof rec.destinationAddress === "string") out.destinationAddress = rec.destinationAddress;
  if (Array.isArray(rec.transfers)) {
    const transfers = rec.transfers.filter((item): item is NormalizedCryptoTransfer => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const t = item as Record<string, unknown>;
      return (t.kind === "merchant" || t.kind === "platform_fee") &&
        typeof t.destinationAddress === "string" &&
        typeof t.amountAtomic === "string" &&
        typeof t.amountDisplay === "string";
    });
    if (transfers.length) out.transfers = transfers.map(t => ({ kind: t.kind, destinationAddress: t.destinationAddress,
      amountAtomic: t.amountAtomic, amountDisplay: t.amountDisplay }));
  }
  if (typeof rec.quoteExpiresAt === "string") out.quoteExpiresAt = rec.quoteExpiresAt;
  if (typeof rec.walletConnectProjectId === "string") out.walletConnectProjectId = rec.walletConnectProjectId;
  return Object.keys(out).length ? out : undefined;
}

function snapshotFromRecord(row: {
  version?: number;
  amountBreakdown?: unknown;
  creation?: unknown;
  id: string;
  merchantId: string;
  sessionId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  method: string;
  status: string;
  providerPaymentId: string | null;
  approvedAmountCents: number | null;
  acceptedOfferId: string | null;
  commerceOrderId?: string | null;
  buyerFacing: unknown;
  statusHistory?: unknown;
}): PaymentIntentSnapshot {
  return {
    version: row.version ?? 0,
    amountBreakdown: row.amountBreakdown ? row.amountBreakdown as PaymentIntentSnapshot["amountBreakdown"] : undefined,
    creation: row.creation ? row.creation as PaymentIntentSnapshot["creation"] : undefined,
    id: row.id,
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    idempotencyKey: row.idempotencyKey,
    amountCents: row.amountCents,
    currency: row.currency,
    method: row.method as PaymentMethod,
    status: row.status as PaymentIntentStatus,
    providerPaymentId: row.providerPaymentId ?? undefined,
    approvedAmountCents: row.approvedAmountCents ?? undefined,
    acceptedOfferId: row.acceptedOfferId ?? undefined,
    commerceOrderId: row.commerceOrderId ?? undefined,
    buyerFacing: normalizeBuyerFacing(row.buyerFacing),
    statusHistory: Array.isArray(row.statusHistory)
      ? (row.statusHistory as PaymentIntentSnapshot["statusHistory"])
      : [{ status: row.status as PaymentIntentStatus, occurredAt: new Date().toISOString() }]
  };
}

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient,
    private readonly captureCoupon?: (tx: PrismaTx, snapshot: PaymentIntentSnapshot, scope?: StorefrontCouponPaymentScope)
      => Promise<ReturnType<typeof readPaymentCouponAuthority>>,
    private readonly captureWidgetCheckout?: CaptureWidgetCheckoutPayment,
    private readonly captureNormalCrossSell?: CaptureNormalCrossSellPayment) {}

  async listForSession(merchantId: string, sessionId: string): Promise<PaymentIntentEntity[]> {
    const rows = await this.prisma.paymentIntent.findMany({ where: { merchantId, sessionId }, orderBy: { createdAt: "desc" } });
    return rows.map(row => PaymentIntentEntity.rehydrate(snapshotFromRecord(row)));
  }

  async hasCommittedPaymentForSession(merchantId: string, sessionId: string): Promise<boolean> {
    const row = await this.prisma.paymentIntent.findFirst({
      where: { merchantId, sessionId, status: { notIn: ["failed", "cancelled"] } },
      select: { id: true },
    });
    return row !== null;
  }

  async saveIntent(input: SavePaymentIntentInput): Promise<void> {
    const snapshot = input.intent.snapshot();
    const originalNormal = readPaymentNormalCrossSellAuthority(snapshot);
    const originalWidget = readPaymentWidgetCheckoutAuthority(snapshot);
    await this.prisma.$transaction(tx => this.saveVersion(tx, snapshot));
    const capturedWidget = readPaymentWidgetCheckoutAuthority(snapshot);
    if (capturedWidget && !originalWidget) input.intent.acknowledgeWidgetCheckoutCapture(capturedWidget);
    const capturedNormal = readPaymentNormalCrossSellAuthority(snapshot);
    if (capturedNormal && !originalNormal) input.intent.acknowledgeNormalCrossSellCapture(capturedNormal);
    input.intent.persisted((snapshot.version ?? 0) + 1);
  }

  async saveIntentWithSettlementPlan(input: SavePaymentIntentWithSettlementPlanInput): Promise<void> {
    const snapshot = input.intent.snapshot();
    const originalNormal = readPaymentNormalCrossSellAuthority(snapshot);
    const originalCoupon = readPaymentCouponAuthority(snapshot);
    const originalWidget = readPaymentWidgetCheckoutAuthority(snapshot);
    const scope = input.storefrontCouponScope === undefined ? undefined : parseStorefrontCouponPaymentScope(input.storefrontCouponScope);
    await this.prisma.$transaction(async tx => {
      await this.saveVersion(tx, snapshot, scope);
      if (!snapshot.creation?.input.marketplaceFunding) await appendPlannedSettlementInTransaction(tx, input.settlementPlan);
    });
    const captured = readPaymentCouponAuthority(snapshot);
    if (captured && !originalCoupon) input.intent.acknowledgeCouponCapture(captured);
    const capturedWidget = readPaymentWidgetCheckoutAuthority(snapshot);
    if (capturedWidget && !originalWidget) input.intent.acknowledgeWidgetCheckoutCapture(capturedWidget);
    const capturedNormal = readPaymentNormalCrossSellAuthority(snapshot);
    if (capturedNormal && !originalNormal) input.intent.acknowledgeNormalCrossSellCapture(capturedNormal);
    input.intent.persisted((snapshot.version ?? 0) + 1);
  }

  async saveIntentWithOutbox(input: SavePaymentIntentInput, event: DomainEventEnvelope): Promise<void> {
    const snapshot = input.intent.snapshot();
    const originalNormal = readPaymentNormalCrossSellAuthority(snapshot);
    const originalWidget = readPaymentWidgetCheckoutAuthority(snapshot);
    const outboxArgs = outboxUpsertArgs(event);
    await this.prisma.$transaction(async (tx: PrismaTx) => {
      await this.saveVersion(tx, snapshot);
      await tx.outboxMessage.upsert(outboxArgs);
    });
    const capturedWidget = readPaymentWidgetCheckoutAuthority(snapshot);
    if (capturedWidget && !originalWidget) input.intent.acknowledgeWidgetCheckoutCapture(capturedWidget);
    const capturedNormal = readPaymentNormalCrossSellAuthority(snapshot);
    if (capturedNormal && !originalNormal) input.intent.acknowledgeNormalCrossSellCapture(capturedNormal);
    input.intent.persisted((snapshot.version ?? 0) + 1);
  }

  private async saveVersion(tx: PrismaTx, snapshot: PaymentIntentSnapshot, trustedScope?: StorefrontCouponPaymentScope): Promise<void> {
    const frozenCoupon = readPaymentCouponAuthority(snapshot);
    const frozenWidget = readPaymentWidgetCheckoutAuthority(snapshot);
    const frozenNormal = readPaymentNormalCrossSellAuthority(snapshot);
    const isMarketplace = Boolean(snapshot.creation?.input.marketplaceFunding);
    const couponAdmission = trustedScope !== undefined || frozenCoupon !== undefined;
    if (frozenWidget && (couponAdmission || isMarketplace)) throw new Error("payment_widget_checkout_authority_conflict");
    if (couponAdmission && isMarketplace) throw new Error("checkout_coupon_binding_conflict");
    if (!isMarketplace) await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${snapshot.merchantId} FOR UPDATE`;
    const legacyCreation = snapshot.creation && !snapshot.creation.input.marketplaceFunding;
    const publicMarketplaceCreation = snapshot.creation?.input.marketplacePublicAdmission !== undefined;
    const couldAdmit = (legacyCreation || publicMarketplaceCreation) && ((snapshot.version ?? 0) === 0 ||
      (snapshot.status === "pending" && !snapshot.providerPaymentId && snapshot.creation?.state === "in_flight"));
    // Opt-in widget admission reacquires these through the canonical reader.
    // Acquire configuration before session, preserving the shared lock order.
    // Default legacy/coupon callers retain their original fences unchanged.
    if (couponAdmission || legacyCreation && couldAdmit || this.captureWidgetCheckout && couldAdmit && !isMarketplace)
      await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id = ${snapshot.merchantId} FOR UPDATE`;
    if ((this.captureWidgetCheckout || this.captureNormalCrossSell) && couldAdmit && !isMarketplace) {
      await tx.$queryRaw`SELECT merchant_id FROM checkout_settings WHERE merchant_id = ${snapshot.merchantId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id = ${snapshot.merchantId} FOR SHARE`;
    } else if (legacyCreation && couldAdmit) {
      await tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id = ${snapshot.merchantId} FOR SHARE`;
    }
    if (!isMarketplace) {
      const paymentSessionLock = JSON.stringify(["payment-session", snapshot.merchantId, snapshot.sessionId]);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentSessionLock}, 0))::text`;
    }
    // Admission and the first send share the canonical checkout row lock with
    // cart writers. Later reconciliation/receipts must remain available.
    let admissionCart: unknown;
    let admissionSession: { merchantId: string; sessionId: string; cart: unknown; customer: unknown; shipping: unknown } | null = null;
    if (couldAdmit) {
      await lockCheckoutSessionAnchor(tx, snapshot.merchantId, snapshot.sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${snapshot.merchantId} AND session_id = ${snapshot.sessionId} FOR UPDATE`;
      const stored = await tx.checkoutSession.findUnique({
        where: { merchantId_sessionId: { merchantId: snapshot.merchantId, sessionId: snapshot.sessionId } },
        select: { merchantId: true, sessionId: true, cart: true, customer: true, shipping: true },
      });
      admissionSession = stored;
      const cartRef = (stored?.cart as { cart_ref?: unknown } | null)?.cart_ref;
      admissionCart = stored?.cart;
      const refs = [...new Set([snapshot.sessionId, ...(typeof cartRef === "string" && cartRef.trim() ? [cartRef] : [])])].sort();
      // A cart writer may have checked mutability before this checkout existed.
      // Wait for that writer's lines before deciding whether legacy admission is safe.
      for (const ref of refs) {
        const key = JSON.stringify(["storefront-cart", snapshot.merchantId, ref]);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
      }
    }
    const current = await tx.paymentIntent.findUnique({ where: { id: snapshot.id } });
    if (!current && frozenWidget) throw new Error("payment_widget_checkout_authority_conflict");
    if (!current && frozenNormal) throw new Error("payment_normal_cross_sell_authority_conflict");
    const previousCreation = current?.creation as PaymentIntentSnapshot["creation"];
    const firstSend = current && previousCreation?.state === "ready" && !previousCreation.firstAttemptAt &&
      snapshot.creation?.state === "in_flight" && !current.providerPaymentId;
    // The lock arm is deliberately broader than admission: an uncertain prior
    // attempt can also claim a recovery lease. Do not block its reconciliation.
    if (couldAdmit && (!current || firstSend)) {
      let hasWidgetReceipt = false;
      try { hasWidgetReceipt = admissionCart !== null && typeof admissionCart === "object" && "_widgetCrossSellAcceptance" in admissionCart; }
      catch { throw new Error("cross_sell_quote_review_required"); }
      if (hasWidgetReceipt || frozenWidget) {
        if (!hasWidgetReceipt || couponAdmission || isMarketplace || !this.captureWidgetCheckout || !snapshot.creation) {
          assertNoUnprojectedWidgetReceipt(admissionCart);
          throw new Error("payment_widget_checkout_authority_conflict");
        }
        assertNoCheckoutCouponBindingInput(admissionCart);
        if (current) {
          if ((current.version ?? 0) !== (snapshot.version ?? 0)) throw new PaymentIntentConflictError();
          if (!frozenWidget) throw new Error("payment_widget_checkout_authority_conflict");
          // Actual persisted identity is proved before the callback can request
          // the canonical reader's independently fenced own-row exception.
          assertSamePaymentIdentity(snapshotFromRecord(current), snapshot);
        }
        const authority = await this.captureWidgetCheckout(tx, snapshot);
        const admitted = { ...snapshot, creation: { ...snapshot.creation, widgetCheckoutAuthority: authority } };
        readPaymentWidgetCheckoutAuthority(admitted);
        if (current) assertSamePaymentWidgetCheckoutAuthority(snapshot, admitted);
        else snapshot.creation = admitted.creation;
      } else {
        assertNoUnprojectedWidgetReceipt(admissionCart);
        if (legacyCreation) await assertNeighborhoodPaymentAdmission(tx, {
          merchantId: snapshot.merchantId, sessionId: snapshot.sessionId,
        }, admissionSession);
        // A new journal cannot arrive pre-authorized, including through a generic
        // repository call. Only this fenced admission may capture its sibling.
        if (!current && frozenCoupon) throw new Error("checkout_coupon_binding_conflict");
        const source = admissionCart as { source?: unknown; cart_ref?: unknown } | null;
        const storefrontSource = source?.source === "storefront" && typeof source.cart_ref === "string" && source.cart_ref.trim().length > 0;
        if (couponAdmission || storefrontSource) {
          if (!this.captureCoupon) throw new Error("checkout_coupon_binding_conflict");
          const authority = await this.captureCoupon(tx, snapshot, current ? undefined : trustedScope);
          if (frozenCoupon && !authority) throw new Error("checkout_coupon_binding_conflict");
          if (!current && authority && snapshot.creation) {
            snapshot.creation = { ...snapshot.creation, couponAuthority: authority };
            readPaymentCouponAuthority(snapshot);
          }
        } else assertNoCheckoutCouponBindingInput(admissionCart);
        const cart = admissionCart as { source?: unknown; items?: unknown; currentDiscount?:unknown } | null;
        const hasIntent = Array.isArray(cart?.items) && cart.items.some(item => item !== null && typeof item === "object" && "crossSellIntent" in item);
        const hasDiscount = typeof cart?.currentDiscount === "number" && Number.isFinite(cart.currentDiscount) && cart.currentDiscount > 0;
        // Existing storefront V1 intents are not normal-checkout acceptance.
        // Actual normal history also survives removal of every target when an
        // independent D remains. This selects canonical admission, never grants
        // authority from a body/cart flag or from an unproved discount alone.
        const normalSourceEvent = (hasIntent && cart?.source === "storefront" || hasDiscount) ? await tx.outboxMessage.findFirst({ where: {
          merchantId: snapshot.merchantId, eventType: "cross-sell.offer.accepted", producer: "cross-sell",
          payload: { path: ["ack", "sessionId"], equals: snapshot.sessionId },
          AND: [{ payload: { path: ["protocol"], equals: "normal_checkout_cross_sell_v1" } }],
        }, select: { eventId: true } }) : null;
        if (frozenNormal || hasIntent && cart?.source !== "storefront" || normalSourceEvent && (hasIntent || hasDiscount)) {
          if (!snapshot.creation || isMarketplace || !this.captureNormalCrossSell) throw new Error("payment_normal_cross_sell_authority_conflict");
          if (current) {
            if ((current.version ?? 0) !== (snapshot.version ?? 0)) throw new PaymentIntentConflictError();
            if (!frozenNormal) throw new Error("payment_normal_cross_sell_authority_conflict");
            assertSamePaymentIdentity(snapshotFromRecord(current), snapshot);
          }
          const authority = await this.captureNormalCrossSell(tx, snapshot);
          const admitted = { ...snapshot, creation: { ...snapshot.creation, normalCrossSellAuthority: authority } };
          readPaymentNormalCrossSellAuthority(admitted);
          if (current) assertSamePaymentNormalCrossSellAuthority(snapshot, admitted);
          else snapshot.creation = admitted.creation;
        }
      }
    }
    if (publicMarketplaceCreation && (!current || firstSend)) {
      if (current) {
        if ((current.version ?? 0) !== (snapshot.version ?? 0)) throw new PaymentIntentConflictError();
        assertSamePaymentIdentity(snapshotFromRecord(current), snapshot);
      }
      // The worker can resume a ready journal without calling the public
      // endpoint. Recheck policy and canonical shipping under the same locks
      // before committing its first-send lease. Uncertain reads remain open.
      assertMarketplacePublicPaymentPolicy(snapshot.creation!.input);
      await assertMarketplacePublicPaymentCheckout(tx, snapshot.creation!.input);
    }
    if (legacyCreation && (!current || firstSend) && await hasMarketplaceCheckout(tx, { merchantId: snapshot.merchantId, sessionId: snapshot.sessionId })) {
      throw new ServiceUnavailableException("marketplace_checkout_not_ready");
    }
    if (!isMarketplace && (!current || firstSend || snapshot.creation?.cancellation && !previousCreation?.cancellation)) {
      const active = await tx.paymentIntent.findMany({ where: { merchantId: snapshot.merchantId, sessionId: snapshot.sessionId,
        status: { in: ["pending", "requires_action"] } }, select: { id: true, creation: true, providerPaymentId: true } });
      if ((!current || firstSend) && active.some(row => ["in_flight", "uncertain"].includes((row.creation as unknown as PaymentIntentSnapshot["creation"])?.cancellation?.state ?? ""))) {
        throw new ConflictException("payment_cancellation_pending");
      }
      if (snapshot.creation?.cancellation && !previousCreation?.cancellation && active.some(row => row.id !== snapshot.id && !row.providerPaymentId &&
          ["in_flight", "uncertain"].includes((row.creation as unknown as PaymentIntentSnapshot["creation"])?.state ?? ""))) {
        throw new ConflictException("payment_creation_in_progress");
      }
    }

    const args = paymentIntentUpsertArgs(snapshot);
    if (!current) {
      if ((snapshot.version ?? 0) !== 0) throw new PaymentIntentConflictError();
      if (await tx.paymentIntent.findFirst({ where: { merchantId: snapshot.merchantId, sessionId: snapshot.sessionId, status: { notIn: ["failed", "cancelled"] } }, select: { id: true } })) throw new PaymentIntentConflictError();
      if (!isMarketplace) {
        const content = await snapshotDigitalPaymentContent(tx, snapshot.merchantId, snapshot.sessionId);
        args.create.digitalContent = content as unknown as Prisma.InputJsonValue;
      }
      if (!isMarketplace) await validateIncentivePayment(tx, snapshot);
      try { await tx.paymentIntent.create({ data: args.create }); }
      catch (error) {
        if ((error as { code?: string }).code === "P2002") throw new PaymentIntentConflictError();
        throw error;
      }
      if (!isMarketplace) await recordIncentivePayment(tx, snapshot);
      await freezeMarketplaceFunding(tx, snapshot);
      return;
    }
    if ((current.version ?? 0) !== (snapshot.version ?? 0)) throw new PaymentIntentConflictError();
    assertSamePaymentIdentity(snapshotFromRecord(current), snapshot);
    if (snapshot.creation?.input.marketplaceFunding) {
      const plan = await tx.marketplaceFundingPlan.findUnique({ where: { paymentIntentId: snapshot.id } });
      if (!plan || plan.instructionsHash !== fundingHash(snapshot.creation.input.marketplaceFunding)) {
        throw new Error("marketplace_funding_immutable_plan_required");
      }
    }
    const updated = await tx.paymentIntent.updateMany({ where: { id: snapshot.id, merchantId: snapshot.merchantId, version: snapshot.version ?? 0 }, data: args.update });
    if (updated.count !== 1) throw new PaymentIntentConflictError();
    if (!isMarketplace) await recordIncentivePayment(tx, snapshot);
  }

  async listStalePending(query: StalePendingQuery): Promise<PaymentIntentEntity[]> {
    const rows = await this.prisma.paymentIntent.findMany({
      where: {
        status: { in: ["pending", "requires_action"] },
        method: { not: "qa_fixture" },
        updatedAt: { lt: query.olderThan }
      },
      orderBy: { updatedAt: "asc" },
      take: query.limit
    });
    return rows.map((row) => PaymentIntentEntity.rehydrate(snapshotFromRecord(row)));
  }

  /**
   * R2P-P03: Approved intents idle since `olderThan`. A healthy approval flow
   * finishes completeAfterApproval within seconds, so an intent left `approved`
   * beyond the stale window signals a crash between markApproved and
   * completion. Re-driving completeAfterApproval is safe (idempotent via
   * CompleteOrderUseCase).
   */
  async listStaleApproved(query: StalePendingQuery): Promise<PaymentIntentEntity[]> {
    const rows = await this.prisma.paymentIntent.findMany({
      where: {
        status: "approved",
        method: { not: "qa_fixture" },
        updatedAt: { lt: query.olderThan }
      },
      orderBy: { updatedAt: "asc" },
      take: query.limit
    });
    return rows.map((row) => PaymentIntentEntity.rehydrate(snapshotFromRecord(row)));
  }

  async getByIdempotency(
    merchantId: string,
    sessionId: string,
    idempotencyKey: string
  ): Promise<PaymentIntentEntity | null> {
    const row = await this.prisma.paymentIntent.findUnique({
      where: {
        merchantId_sessionId_idempotencyKey: {
          merchantId: merchantId.trim(),
          sessionId: sessionId.trim(),
          idempotencyKey: idempotencyKey.trim()
        }
      }
    });
    return row ? PaymentIntentEntity.rehydrate(snapshotFromRecord(row)) : null;
  }

  async getByProviderPaymentId(
    merchantId: string,
    providerPaymentId: string
  ): Promise<PaymentIntentEntity | null> {
    const row = await this.prisma.paymentIntent.findFirst({
      where: {
        merchantId: merchantId.trim(),
        providerPaymentId: providerPaymentId.trim()
      }
    });
    return row ? PaymentIntentEntity.rehydrate(snapshotFromRecord(row)) : null;
  }

  async findApprovedBySessionId(
    merchantId: string,
    sessionId: string
  ): Promise<PaymentIntentEntity | null> {
    const row = await this.prisma.paymentIntent.findFirst({
      where: { merchantId: merchantId.trim(), sessionId: sessionId.trim(), status: "approved" },
      orderBy: { updatedAt: "desc" },
    });
    return row ? PaymentIntentEntity.rehydrate(snapshotFromRecord(row)) : null;
  }

  async getIntentById(merchantId: string, intentBusinessId: string): Promise<PaymentIntentEntity | null> {
    // C2 fix: atomic tenant boundary — scope the query directly with both id and merchantId
    const row = await this.prisma.paymentIntent.findUnique({
      where: { id: intentBusinessId.trim() }
    });
    if (!row) return null;
    // Post-read verification: query already matched id, verify merchantId atomically
    if (row.merchantId !== merchantId.trim()) return null;
    return PaymentIntentEntity.rehydrate(snapshotFromRecord(row));
  }

  async getIntentByExternalReference(
    externalReference: string
  ): Promise<{ id: string; merchantId: string } | null> {
    const row = await this.prisma.paymentIntent.findUnique({
      where: { id: externalReference.trim() },
      select: { id: true, merchantId: true }
    });
    return row ? { id: row.id, merchantId: row.merchantId } : null;
  }

  async getIntentReferenceByProviderPaymentId(
    providerPaymentId: string
  ): Promise<{ id: string; merchantId: string } | null> {
    const row = await this.prisma.paymentIntent.findFirst({
      where: { providerPaymentId: providerPaymentId.trim() },
      select: { id: true, merchantId: true }
    });
    return row ? { id: row.id, merchantId: row.merchantId } : null;
  }

  async hasProcessedProviderEvent(key: ProviderEventKey): Promise<boolean> {
    const row = await this.prisma.paymentProviderEvent.findFirst({
      where: {
        provider: key.provider,
        merchantId: key.merchantId,
        eventId: key.eventId.trim()
      }
    });
    return Boolean(row);
  }

  async recordProcessedProviderEvent(key: ProviderEventKey): Promise<boolean> {
    const eventId = key.eventId.trim();
    try {
      await this.prisma.paymentProviderEvent.create({
        data: {
          id: `${key.provider}:${key.merchantId ?? "_"}:${eventId}`,
          provider: key.provider,
          merchantId: key.merchantId,
          eventId
        }
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
    }
  }

  async deleteProcessedProviderEvent(key: ProviderEventKey): Promise<void> {
    await this.prisma.paymentProviderEvent.deleteMany({
      where: {
        provider: key.provider,
        merchantId: key.merchantId,
        eventId: key.eventId.trim()
      }
    });
  }

  async recordCryptoTransfer(key: CryptoTransferKey): Promise<boolean> {
    const chain = key.chain.trim().toLowerCase();
    const txHash = key.txHash.trim().toLowerCase();
    try {
      await this.prisma.paymentCryptoTransfer.create({
        data: {
          id: `${chain}:${txHash}`,
          chain,
          txHash,
          merchantId: key.merchantId.trim(),
          intentId: key.intentId.trim()
        }
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
    }
  }

  async deleteCryptoTransfer(key: Pick<CryptoTransferKey, "chain" | "txHash">): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const where = { chain: key.chain.trim().toLowerCase(), txHash: key.txHash.trim().toLowerCase() };
      const reservation = await tx.paymentCryptoTransfer.findFirst({ where });
      if (!reservation) return;
      const rows = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM payment_intents WHERE id = ${reservation.intentId}
        AND merchant_id = ${reservation.merchantId} FOR UPDATE`;
      // A verifier may still be running in another request. Only terminal unpaid
      // states prove that a later CAS approval cannot consume this reservation.
      if (!rows.length || !["failed", "cancelled"].includes(rows[0].status)) return;
      await tx.paymentCryptoTransfer.deleteMany({ where: { ...where, id: reservation.id, intentId: reservation.intentId } });
    });
  }

  /**
   * Reap expired reservations only when the owner is terminal and unpaid.
   * Unresolved, approved and refunded intents retain their settlement uniqueness.
   */
  async reapExpiredCryptoReservations(): Promise<number> {
    const now = new Date();
    // Enumerate expired reservations, then check each owner under its row lock.
    const expired = await this.prisma.paymentCryptoTransfer.findMany({
      where: {
        expiresAt: { lt: now }
      },
      select: { id: true, intentId: true, merchantId: true, chain: true, txHash: true }
    });

    if (expired.length === 0) return 0;

    // Expiry alone cannot prove that an in-flight verifier stopped. Preserve
    // reservations unless the intent has reached a terminal non-paid state.
    let count = 0;
    for (const reservation of expired) {
      count += await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status FROM payment_intents WHERE id = ${reservation.intentId}
          AND merchant_id = ${reservation.merchantId} FOR UPDATE`;
        if (!rows.length || !["failed", "cancelled"].includes(rows[0].status)) return 0;
        return (await tx.paymentCryptoTransfer.deleteMany({ where: { id: reservation.id, expiresAt: { lt: now } } })).count;
      });
    }
    return count;
  }

  async listByMerchantId(
    merchantId: string,
    statusPrefix?: string,
  ): Promise<PaymentIntentEntity[]> {
    const rows = await this.prisma.paymentIntent.findMany({
      where: {
        merchantId,
        ...(statusPrefix && { status: { startsWith: statusPrefix } }),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map((row) => PaymentIntentEntity.rehydrate(snapshotFromRecord(row)));
  }

async listBySessionId(merchantId: string, sessionId: string): Promise<PaymentIntentEntity[]> {
    if (!merchantId.trim() || !sessionId.trim()) return [];
    const rows = await this.prisma.paymentIntent.findMany({
      where: { merchantId: merchantId.trim(), sessionId: sessionId.trim() },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => PaymentIntentEntity.rehydrate(snapshotFromRecord(row)));
  }
}
