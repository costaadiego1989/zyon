import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { MARKETPLACE_TERMINAL_CANCELLATION_REASON, type MarketplaceCancellationEvidence, type MarketplaceCancellationRepository, type MarketplaceCancellationRequest } from "../../domain/ports/marketplace-cancellation.port.js";
import { assertMarketplaceUncapturedAllocation, type UncapturedMarketplaceFunding } from "../../domain/services/marketplace-cancellation-allocation.js";
import { fundingHash, lockMarketplaceOrder } from "./prisma-marketplace-funding.repository.js";
import type { MarketplaceCancellationExecutionRepository, MarketplaceCancellationExecutionRequest, MarketplaceCancellationObservation, MarketplaceCancellationOperation, MarketplaceCancellationReason } from "../../domain/ports/marketplace-cancellation-execution.port.js";

const conflict = () => new ConflictException("marketplace_cancellation_reconciliation_required");
const eventId = (id: string) => `marketplace_cancel_${createHash("sha256").update(id).digest("hex")}`;

@Injectable()
export class PrismaMarketplaceCancellationRepository implements MarketplaceCancellationRepository, MarketplaceCancellationExecutionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async prepare(hostMerchantId: string, paymentIntentId: string, reason: MarketplaceCancellationReason): Promise<MarketplaceCancellationOperation> {
    if (!hostMerchantId?.trim() || !paymentIntentId?.trim() || !["requested_by_customer", "abandoned", "duplicate", "fraudulent"].includes(reason)) throw conflict();
    return this.prisma.$transaction(async tx => {
      const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: hostMerchantId } });
      if (!payment?.providerPaymentId) throw conflict();
      await lockMarketplaceOrder(tx, hostMerchantId, payment.providerPaymentId);
      const existing = await tx.marketplaceCancellationOperation.findUnique({ where: { fundingPlanId: paymentIntentId } });
      if (existing) {
        const operation = this.mapOperation(existing);
        if (operation.hostMerchantId !== hostMerchantId || operation.request.cancellationReason !== reason ||
            operation.request.providerPaymentId !== payment.providerPaymentId) throw conflict();
        return operation;
      }
      const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId, hostMerchantId } });
      if (!plan || !["stripe", "asaas", "mercadopago"].includes(plan.provider) || !["test", "live"].includes(plan.environment)) throw conflict();
      const input = (payment.creation as { state?: string; input?: { asaasCustomerId?: string; method?: string } } | null)?.input;
      const provider = plan.provider as MarketplaceCancellationExecutionRequest["provider"];
      const body = { ...(provider === "asaas" ? { version: 2 as const, provider, asaasCustomerId: input?.asaasCustomerId ?? "",
          asaasBillingType: (input?.method === "pix" ? "PIX" : input?.method === "boleto" ? "BOLETO" : "") as "PIX" | "BOLETO" } : { version: 1 as const, provider }),
        hostMerchantId, paymentIntentId, checkoutSessionId: plan.checkoutSessionId,
        instructionsHash: plan.instructionsHash, environment: plan.environment as "test" | "live",
        accountFingerprint: plan.accountFingerprint, providerPaymentId: payment.providerPaymentId, amountCents: plan.amountCents,
        currency: "BRL" as const, cancellationReason: reason, reference: `mcancel_${fundingHash([hostMerchantId, paymentIntentId, plan.instructionsHash])}` };
      const request = { ...body, requestHash: fundingHash(body) } as MarketplaceCancellationExecutionRequest;
      await this.admit(tx, request);
      const row = await tx.marketplaceCancellationOperation.create({ data: { fundingPlanId: paymentIntentId, hostMerchantId,
        provider: plan.provider, accountFingerprint: plan.accountFingerprint, reference: request.reference, requestHash: request.requestHash,
        request: request as unknown as Prisma.InputJsonValue, status: "planned" } });
      await tx.outboxMessage.create({ data: { eventId: `marketplace_cancellation_prepared_${row.id}`, eventType: "marketplace.cancellation.prepared",
        schemaVersion: 1, merchantId: hostMerchantId, occurredAt: new Date(), correlationId: paymentIntentId, causationId: row.id, producer: "marketplace",
        payload: { operation_id: row.id, payment_intent_id: paymentIntentId, reason, request_hash: request.requestHash } } });
      return this.mapOperation(row);
    });
  }

  async claim(hostMerchantId: string, operationId: string, now: Date, options?: { reconcileOnly?: boolean }) {
    if (!Number.isFinite(now.getTime())) throw conflict();
    return this.prisma.$transaction(async tx => {
      const row = await this.lockOperation(tx, hostMerchantId, operationId);
      if (!row) return undefined;
      const operation = this.mapOperation(row);
      if (row.status !== "planned") return { operation, submit: false };
      if (options?.reconcileOnly) return undefined;
      if (row.claimedAt || row.confirmedAt || row.blockReason) throw conflict();
      // Full immutable identity, economic allocation, order and stock proof is checked
      // again under the same locks used by capture and stock consumption.
      await this.admit(tx, operation.request);
      const claimed = await tx.marketplaceCancellationOperation.update({ where: { id: row.id, version: row.version, status: "planned" },
        data: { status: "unknown", version: { increment: 1 }, claimedAt: now } });
      return { operation: this.mapOperation(claimed), submit: true };
    });
  }

  async record(operation: MarketplaceCancellationOperation, observation: MarketplaceCancellationObservation) {
    return this.prisma.$transaction(async tx => {
      const row = await this.lockOperation(tx, operation.hostMerchantId, operation.operationId);
      if (!row || row.status !== "unknown" || row.version !== operation.version) return false;
      const current = this.mapOperation(row);
      if (operation.paymentIntentId !== current.paymentIntentId || fundingHash(operation.request) !== fundingHash(current.request)) throw conflict();
      const now = new Date();
      if (observation.state === "confirmed") {
        this.validateEvidence(observation.evidence, now);
        const proof = observation.evidence, request = current.request;
        if (proof.hostMerchantId !== request.hostMerchantId || proof.paymentIntentId !== request.paymentIntentId ||
            proof.instructionsHash !== request.instructionsHash || proof.providerPaymentId !== request.providerPaymentId ||
            proof.accountFingerprint !== request.accountFingerprint || proof.environment !== request.environment || proof.amountCents !== request.amountCents ||
            proof.provider !== request.provider || proof.provider === "mercadopago" && proof.checkoutSessionId !== request.checkoutSessionId) throw conflict();
        await this.releaseInside(tx, proof, now);
        // releaseInside also closes the operation, with the stock and status event.
        return true;
      }
      if (observation.state === "blocked") {
        const observed = Date.parse(observation.observedAt);
        if (observation.reason !== "marketplace_cancellation_capture_observed" || observation.requestHash !== row.requestHash ||
            observation.providerPaymentId !== current.request.providerPaymentId || !Number.isSafeInteger(observation.amountReceivedCents) ||
            observation.amountReceivedCents <= 0 || observation.amountReceivedCents > current.request.amountCents || !Number.isFinite(observed) ||
            observed < now.getTime() - 300_000 || observed > now.getTime() + 60_000) throw conflict();
        await tx.marketplaceCancellationOperation.update({ where: { id: row.id, version: row.version }, data: {
          status: "blocked", blockReason: observation.reason, reconciledAt: now, version: { increment: 1 } } });
        await tx.outboxMessage.create({ data: { eventId: `marketplace_cancellation_blocked_${row.id}`, eventType: "marketplace.cancellation.blocked",
          schemaVersion: 1, merchantId: row.hostMerchantId, occurredAt: now, correlationId: row.fundingPlanId, causationId: row.id,
          producer: "marketplace", payload: { operation_id: row.id, payment_intent_id: row.fundingPlanId, reason: observation.reason,
            provider_payment_id: observation.providerPaymentId, amount_received_cents: observation.amountReceivedCents, observed_at: observation.observedAt } } });
        return true;
      }
      if (observation.state !== "unknown") throw conflict();
      if (observation.asaas) {
        const proof = observation.asaas, request = current.request, observed = Date.parse(proof.observedAt);
        if (request.provider !== "asaas" || request.version !== 2 || proof.requestHash !== request.requestHash ||
            proof.providerPaymentId !== request.providerPaymentId || proof.customerId !== request.asaasCustomerId ||
            proof.billingType !== request.asaasBillingType || proof.amountCents !== request.amountCents ||
            !["PENDING", "OVERDUE"].includes(proof.status) || !["removed_reversible", "active_uncaptured"].includes(proof.state) ||
            !Number.isFinite(observed) || observed < now.getTime() - 300_000 || observed > now.getTime() + 60_000) throw conflict();
        // Recheck after the shared order lock: capture/order creation may have
        // completed while the provider GET was in progress. No monetary or stock
        // state is changed by this operational receipt.
        await this.admit(tx, request);
        const removedId = `marketplace_cancellation_removed_${row.id}`;
        const removed = await tx.outboxMessage.findUnique({ where: { eventId: removedId } });
        if (proof.state === "removed_reversible" || removed) {
          const eventId = proof.state === "removed_reversible" ? removedId : `marketplace_cancellation_reactivated_${row.id}`;
          if (removed && (removed.merchantId !== row.hostMerchantId || removed.eventType !== "marketplace.cancellation.removal_observed" ||
              (removed.payload as { request_hash?: string }).request_hash !== row.requestHash)) throw conflict();
          await tx.outboxMessage.upsert({ where: { eventId }, update: {}, create: { eventId,
            eventType: proof.state === "removed_reversible" ? "marketplace.cancellation.removal_observed" : "marketplace.cancellation.reactivated",
            schemaVersion: 1, merchantId: row.hostMerchantId, occurredAt: now, correlationId: row.fundingPlanId, causationId: row.id,
            producer: "marketplace", payload: { operation_id: row.id, payment_intent_id: row.fundingPlanId, request_hash: row.requestHash,
              provider: "asaas", provider_payment_id: proof.providerPaymentId, state: proof.state, status: proof.status,
              billing_type: proof.billingType, amount_cents: proof.amountCents, observed_at: proof.observedAt,
              stock_release_proven: false } } });
        }
      }
      await tx.marketplaceCancellationOperation.update({ where: { id: row.id, version: row.version },
        data: { reconciledAt: now, version: { increment: 1 } } });
      return true;
    });
  }

  async listUnresolved(limit: number) {
    return (await this.prisma.marketplaceCancellationOperation.findMany({ where: { status: "unknown" },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: Math.min(100, Math.max(1, Number.isSafeInteger(limit) ? limit : 20)),
      select: { id: true, hostMerchantId: true } })).map(row => ({ operationId: row.id, hostMerchantId: row.hostMerchantId }));
  }

  private async lockOperation(tx: Prisma.TransactionClient, hostMerchantId: string, operationId: string) {
    const first = await tx.marketplaceCancellationOperation.findFirst({ where: { id: operationId, hostMerchantId }, include: { fundingPlan: true } });
    if (!first || !await tx.paymentIntent.findFirst({ where: { id: first.fundingPlanId, merchantId: hostMerchantId } })) return undefined;
    const operation = this.mapOperation(first);
    await lockMarketplaceOrder(tx, hostMerchantId, operation.request.providerPaymentId);
    await tx.$queryRaw`SELECT id FROM marketplace_cancellation_operations WHERE id = ${first.id} FOR UPDATE`;
    return tx.marketplaceCancellationOperation.findUniqueOrThrow({ where: { id: first.id } });
  }

  private mapOperation(row: { id: string; fundingPlanId: string; hostMerchantId: string; provider: string; accountFingerprint: string;
    request: unknown; requestHash: string; reference: string; status: string; version: number }): MarketplaceCancellationOperation {
    const request = row.request as MarketplaceCancellationExecutionRequest;
    if (!request || typeof request !== "object") throw conflict();
    const { requestHash, ...body } = request;
    if (!(request.provider === "asaas" ? request.version === 2 && /^cus_[A-Za-z0-9_-]+$/.test(request.asaasCustomerId) &&
          ["PIX", "BOLETO"].includes(request.asaasBillingType) && row.status !== "confirmed" :
          request.version === 1 && ["stripe", "mercadopago"].includes(request.provider)) ||
        requestHash !== row.requestHash || fundingHash(body) !== row.requestHash ||
        request.hostMerchantId !== row.hostMerchantId || request.paymentIntentId !== row.fundingPlanId ||
        row.provider !== request.provider || request.accountFingerprint !== row.accountFingerprint || request.reference !== row.reference ||
        row.reference !== `mcancel_${fundingHash([row.hostMerchantId, row.fundingPlanId, request.instructionsHash])}` ||
        !["planned", "unknown", "confirmed", "blocked"].includes(row.status)) throw conflict();
    return { operationId: row.id, hostMerchantId: row.hostMerchantId, paymentIntentId: row.fundingPlanId,
      state: row.status as MarketplaceCancellationOperation["state"], version: row.version, request };
  }

  private async admit(tx: Prisma.TransactionClient, request: MarketplaceCancellationExecutionRequest) {
    const { plan, payment, prior, holds } = await this.lockedState(tx, request);
    if (!["stripe", "asaas", "mercadopago"].includes(plan.provider) || prior || plan.status !== "awaiting_capture" || holds.some(row => row.status !== "ACTIVE") ||
        plan.checkoutSessionId !== request.checkoutSessionId || payment.sessionId !== request.checkoutSessionId) throw conflict();
    const input = (payment.creation as { input?: { intentId?: string; merchantId?: string; sessionId?: string;
      amountCents?: number; currency?: string; method?: string; asaasCustomerId?: string;
      stripeConnectAccountId?: string; merchantPayoutDestination?: unknown; settlementMode?: string } } | null)?.input;
    if (input?.intentId !== payment.id || input.merchantId !== payment.merchantId || input.sessionId !== payment.sessionId ||
        input.amountCents !== payment.amountCents || input.currency !== payment.currency || input.stripeConnectAccountId ||
        input.merchantPayoutDestination || input.settlementMode) throw conflict();
    if (request.provider === "asaas" && (request.version !== 2 || !/^cus_[A-Za-z0-9_-]+$/.test(request.asaasCustomerId) ||
        input.asaasCustomerId !== request.asaasCustomerId || !["pix", "boleto"].includes(payment.method) || input.method !== payment.method ||
        request.asaasBillingType !== (payment.method === "pix" ? "PIX" : "BOLETO") ||
        (payment.creation as { state?: string }).state !== "complete" || !/^pay_[A-Za-z0-9_-]+$/.test(request.providerPaymentId))) throw conflict();
    const totals = new Map<string, { variantId: string; quantity: number }>();
    for (const hold of holds) {
      const prior = totals.get(hold.stockId!);
      if (!Number.isSafeInteger(hold.quantity) || hold.quantity <= 0 || prior && prior.variantId !== hold.variantId) throw conflict();
      const quantity = (prior?.quantity ?? 0) + hold.quantity;
      if (!Number.isSafeInteger(quantity)) throw conflict();
      totals.set(hold.stockId!, { variantId: hold.variantId, quantity });
    }
    for (const [stockId, total] of totals) {
      const stock = await tx.productStock.findFirst({ where: { id: stockId, variantId: total.variantId } });
      if (!stock || stock.reserved < total.quantity) throw conflict();
    }
  }

  private validateEvidence(evidence: MarketplaceCancellationEvidence, now: Date) {
    const observed = Date.parse(evidence.observedAt), cancelled = Date.parse(evidence.cancelledAt);
    if (!["stripe", "mercadopago"].includes(evidence.provider) || evidence.state !== "terminal_uncaptured" || evidence.amountReceivedCents !== 0 ||
        evidence.amountCapturableCents !== 0 || !Number.isFinite(observed) || !Number.isFinite(cancelled) || cancelled <= 0 ||
        cancelled > observed + 60_000 || observed > now.getTime() + 60_000 || now.getTime() - observed > 5 * 60_000) throw conflict();
    if (evidence.provider === "mercadopago") {
      const proof = evidence.mercadoPago;
      if (!evidence.checkoutSessionId?.trim() || !proof || proof.paymentId !== evidence.providerPaymentId ||
          !/^[1-9][0-9]*$/.test(proof.paymentId) || !/^[1-9][0-9]*$/.test(proof.collectorId) || proof.status !== "cancelled" ||
          !["by_collector", "by_payer", "expired"].includes(proof.statusDetail) || proof.captured !== false ||
          proof.netReceivedAmountCents !== 0 || proof.refundedAmountCents !== 0 || proof.dateApproved !== null) throw conflict();
    }
  }

  private async completeOperation(tx: Prisma.TransactionClient, evidence: MarketplaceCancellationEvidence, now: Date) {
    let row = await tx.marketplaceCancellationOperation.findUnique({ where: { fundingPlanId: evidence.paymentIntentId } });
    if (!row || row.status === "confirmed") return;
    const { request } = this.mapOperation(row);
    if (request.hostMerchantId !== evidence.hostMerchantId || request.instructionsHash !== evidence.instructionsHash ||
        request.providerPaymentId !== evidence.providerPaymentId || request.environment !== evidence.environment ||
        request.accountFingerprint !== evidence.accountFingerprint || request.amountCents !== evidence.amountCents || request.provider !== evidence.provider ||
        evidence.provider === "mercadopago" && request.checkoutSessionId !== evidence.checkoutSessionId) throw conflict();
    if (row.status === "blocked") throw conflict();
    // A legacy GET-only reconciliation may finish an intent before its POST claim.
    // The proven terminal cancellation closes that intent without sending anything.
    if (row.status === "planned") row = await tx.marketplaceCancellationOperation.update({ where: { id: row.id, version: row.version },
      data: { status: "unknown", claimedAt: now, version: { increment: 1 } } });
    await tx.marketplaceCancellationOperation.update({ where: { id: row.id, version: row.version, status: "unknown" },
      data: { status: "confirmed", confirmedAt: now, reconciledAt: now, version: { increment: 1 } } });
  }

  async request(hostMerchantId: string, paymentIntentId: string): Promise<MarketplaceCancellationRequest | null> {
    // PaymentIntent is tenant-scoped by Prisma middleware; a nested relation on
    // MarketplaceFundingPlan alone would bypass that read boundary.
    const payment = await this.prisma.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: hostMerchantId } });
    const plan = payment && await this.prisma.marketplaceFundingPlan.findFirst({ where: { paymentIntentId, hostMerchantId } });
    if (!plan || !payment || payment.merchantId !== hostMerchantId || !payment.providerPaymentId || plan.budget ||
        !["awaiting_capture", "held"].includes(plan.status) || !["pending", "requires_action", "failed", "cancelled"].includes(payment.status) ||
        (payment.approvedAmountCents ?? 0) !== 0) return null;
    if (!["stripe", "asaas", "mercadopago"].includes(plan.provider) || !["test", "live"].includes(plan.environment) || payment.currency !== "BRL") return null;
    return { hostMerchantId, paymentIntentId, instructionsHash: plan.instructionsHash, provider: plan.provider as MarketplaceCancellationRequest["provider"],
      ...(plan.provider === "mercadopago" ? { checkoutSessionId: plan.checkoutSessionId } : {}),
      environment: plan.environment as "test" | "live", accountFingerprint: plan.accountFingerprint,
      providerPaymentId: payment.providerPaymentId, amountCents: plan.amountCents, currency: "BRL" };
  }

  async release(evidence: MarketplaceCancellationEvidence): Promise<"released"> {
    const now = new Date();
    this.validateEvidence(evidence, now);
    return this.prisma.$transaction(tx => this.releaseInside(tx, evidence, now));
  }

  private async releaseInside(tx: Prisma.TransactionClient, evidence: MarketplaceCancellationEvidence, now: Date): Promise<"released"> {
      const { plan, payment, prior, history, holds } = await this.lockedState(tx, evidence);
      if (prior) {
        const payload = prior.payload as { reason?: string; marketplace_cancellation?: MarketplaceCancellationEvidence };
        const proof = payload.marketplace_cancellation;
        if (prior.merchantId !== plan.hostMerchantId || prior.eventType !== "payment.status.changed" || payload.reason !== MARKETPLACE_TERMINAL_CANCELLATION_REASON ||
            !proof || proof.paymentIntentId !== evidence.paymentIntentId || proof.providerPaymentId !== evidence.providerPaymentId ||
            proof.accountFingerprint !== evidence.accountFingerprint || proof.instructionsHash !== evidence.instructionsHash ||
            plan.status !== "held" || payment.status !== "cancelled" || holds.some(row => row.status !== "RELEASED")) throw conflict();
        await this.completeOperation(tx, evidence, now);
        return "released";
      }
      if (plan.status !== "awaiting_capture" || holds.some(row => row.status !== "ACTIVE")) throw conflict();
      for (const hold of holds) {
        const stock = await tx.productStock.updateMany({ where: { id: hold.stockId!, variantId: hold.variantId, reserved: { gte: hold.quantity } },
          data: { reserved: { decrement: hold.quantity } } });
        if (stock.count !== 1) throw conflict();
        const changed = await tx.stockReservation.updateMany({ where: { id: hold.id, status: "ACTIVE", marketplaceFundingPlanId: plan.paymentIntentId }, data: { status: "RELEASED" } });
        if (changed.count !== 1) throw conflict();
      }
      await tx.marketplaceFundingPlan.update({ where: { paymentIntentId: plan.paymentIntentId }, data: { status: "held", providerPaymentId: evidence.providerPaymentId } });
      await tx.paymentIntent.update({ where: { id: payment.id }, data: { status: "cancelled", version: { increment: 1 }, buyerFacing: {},
        statusHistory: [...history, { status: "cancelled", occurredAt: now.toISOString(), reason: MARKETPLACE_TERMINAL_CANCELLATION_REASON }] as Prisma.InputJsonValue } });
      await tx.outboxMessage.create({ data: { eventId: eventId(payment.id), eventType: "payment.status.changed", schemaVersion: 1,
        merchantId: plan.hostMerchantId, occurredAt: now, correlationId: payment.id, causationId: payment.id, producer: "marketplace",
        payload: { session_id: payment.sessionId, payment_intent_id: payment.id, status: "cancelled", amount_cents: payment.amountCents,
          method: payment.method, commerce_order_id: payment.commerceOrderId, reason: MARKETPLACE_TERMINAL_CANCELLATION_REASON,
          marketplace_cancellation: evidence } as unknown as Prisma.InputJsonValue } });
      await this.completeOperation(tx, evidence, now);
      return "released";
  }

  private async lockedState(tx: Prisma.TransactionClient, evidence: MarketplaceCancellationRequest) {
    if (!await tx.paymentIntent.findFirst({ where: { id: evidence.paymentIntentId, merchantId: evidence.hostMerchantId } })) throw conflict();
    const first = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: evidence.paymentIntentId, hostMerchantId: evidence.hostMerchantId } });
    if (!first) throw conflict();
    await lockMarketplaceOrder(tx, first.hostMerchantId, evidence.providerPaymentId);
    const cartKey = JSON.stringify(["storefront-cart", first.hostMerchantId, first.checkoutSessionId]);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cartKey}, 0))::text`;
    await tx.$queryRaw`SELECT payment_intent_id FROM marketplace_funding_plans WHERE payment_intent_id = ${first.paymentIntentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM payment_intents WHERE id = ${first.paymentIntentId} FOR UPDATE`;
    const plan = await tx.marketplaceFundingPlan.findUniqueOrThrow({ where: { paymentIntentId: first.paymentIntentId }, include: { payment: true } });
    const payment = plan.payment, instructions = plan.instructions as unknown as UncapturedMarketplaceFunding;
    const creation = payment.creation as { input?: { provider?: string; providerAccountFingerprint?: string; marketplaceFunding?: UncapturedMarketplaceFunding } } | null;
    if (plan.hostMerchantId !== evidence.hostMerchantId || payment.merchantId !== evidence.hostMerchantId ||
        payment.providerPaymentId !== evidence.providerPaymentId || (plan.providerPaymentId && plan.providerPaymentId !== evidence.providerPaymentId) ||
        plan.provider !== evidence.provider || plan.environment !== evidence.environment || plan.accountFingerprint !== evidence.accountFingerprint ||
        plan.instructionsHash !== evidence.instructionsHash || fundingHash(instructions) !== plan.instructionsHash ||
        !creation?.input?.marketplaceFunding || fundingHash(creation.input.marketplaceFunding) !== plan.instructionsHash ||
        creation.input.provider !== plan.provider || creation.input.providerAccountFingerprint !== plan.accountFingerprint ||
        instructions.hostMerchantId !== plan.hostMerchantId || instructions.provider !== plan.provider || instructions.environment !== plan.environment ||
        instructions.accountFingerprint !== plan.accountFingerprint || instructions.amountCents !== plan.amountCents || instructions.currency !== "BRL" ||
        plan.amountCents !== evidence.amountCents || payment.amountCents !== evidence.amountCents || evidence.currency !== "BRL" || payment.currency !== "BRL" ||
        evidence.provider === "mercadopago" && (evidence.checkoutSessionId !== plan.checkoutSessionId || payment.sessionId !== plan.checkoutSessionId) ||
        plan.budget || plan.fundedAt || (payment.approvedAmountCents ?? 0) !== 0 ||
        !["pending", "requires_action", "failed", "cancelled"].includes(payment.status)) throw conflict();
    try { assertMarketplaceUncapturedAllocation(instructions); } catch { throw conflict(); }
    const prior = await tx.outboxMessage.findUnique({ where: { eventId: eventId(payment.id) } });
    const history = payment.statusHistory as Array<{ status?: string; reason?: string }>;
    if (!Array.isArray(history) || history.some(row => ["approved", "refunded"].includes(row.status ?? "") || row.status?.startsWith("chargeback_"))) throw conflict();
    if (await tx.marketplacePayout.count({ where: { fundingPlanId: plan.paymentIntentId } }) ||
        await tx.marketplaceSettlement.count({ where: { hostMerchantId: plan.hostMerchantId, orderId: evidence.providerPaymentId } }) ||
        await tx.marketplaceOrderLedger.count({ where: { hostMerchantId: plan.hostMerchantId, orderId: evidence.providerPaymentId } }) ||
        await tx.completedOrder.count({ where: { merchantId: plan.hostMerchantId,
          externalOrderId: { in: [evidence.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : [])] } } })) throw conflict();
    const items = await tx.crossStoreLineItem.findMany({ where: { hostMerchantId: plan.hostMerchantId, checkoutSessionId: plan.checkoutSessionId } });
    if (items.some(row => row.orderId || row.purchasedAt || row.fulfillmentStatus !== "pending") ||
        items.length !== instructions.lines.filter(row => row.sellerMerchantId !== plan.hostMerchantId).length || items.some(row =>
          !instructions.lines.some(line => line.lineItemId === row.id && line.sellerMerchantId === row.sellerMerchantId &&
            line.grossAmountCents === row.unitPriceCents * row.quantity && line.commissionCents === row.commissionCents))) throw conflict();
    const own = instructions.hostStockItems ?? [];
    if (own.length !== instructions.lines.filter(row => row.sellerMerchantId === plan.hostMerchantId).length) throw conflict();
    for (const variantId of [...new Set([...own.map(row => row.variantId), ...items.flatMap(row => row.sourceVariantId ? [row.sourceVariantId] : [])])].sort()) {
      await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${variantId} FOR UPDATE`;
    }
    const holds = await tx.stockReservation.findMany({ where: { marketplaceFundingPlanId: plan.paymentIntentId }, orderBy: { id: "asc" } });
    const expected = [...own.filter(row => row.requiresStock).map(row => ({ cartId: row.lineItemId, variantId: row.variantId, quantity: row.quantity, id: undefined as string | undefined })),
      ...items.filter(row => row.stockReservationId).map(row => ({ cartId: row.id, variantId: row.sourceVariantId, quantity: row.quantity, id: row.stockReservationId! }))];
    if (holds.length !== expected.length || expected.some(row => holds.filter(hold => hold.cartId === row.cartId && hold.variantId === row.variantId &&
        hold.quantity === row.quantity && (!row.id || hold.id === row.id)).length !== 1) || holds.some(row => !row.stockId)) throw conflict();
    return { plan, payment, prior, history, holds };
  }
}
