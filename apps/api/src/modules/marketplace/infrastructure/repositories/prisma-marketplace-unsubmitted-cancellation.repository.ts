import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { CreateProviderPaymentInput } from "../../../payment/domain/ports/payment-provider.port.js";
import type { MarketplaceCancellationReason } from "../../domain/ports/marketplace-cancellation-execution.port.js";
import { isNeverSubmittedMarketplacePayment, MARKETPLACE_UNSUBMITTED_CANCELLATION_REASON,
  marketplaceUnsubmittedCancellationEventId, type MarketplaceUnsubmittedCancellationProof,
  type MarketplaceUnsubmittedCancellationRepository } from "../../domain/ports/marketplace-unsubmitted-cancellation.port.js";
import { assertMarketplaceUncapturedAllocation, type UncapturedMarketplaceFunding } from "../../domain/services/marketplace-cancellation-allocation.js";
import { fundingHash } from "./prisma-marketplace-funding.repository.js";

const conflict = () => new ConflictException("marketplace_unsubmitted_cancellation_unavailable");
const reasons: readonly string[] = ["requested_by_customer", "abandoned", "duplicate", "fraudulent"];
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const empty = (value: unknown) => value == null || record(value) && Object.keys(value).length === 0;

async function state(reader: Prisma.TransactionClient, host: string, id: string, lockVariants = false) {
  const payment = await reader.paymentIntent.findFirst({ where: { id, merchantId: host } });
  const plan = payment && await reader.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: id, hostMerchantId: host } });
  if (!payment || !plan) throw new NotFoundException("marketplace_payment_not_found");
  const creation = payment.creation as { state?: string; input?: CreateProviderPaymentInput; firstAttemptAt?: unknown;
    leaseToken?: unknown; leaseUntil?: unknown; reason?: unknown } | null;
  const input = creation?.input, instructions = plan.instructions as unknown as UncapturedMarketplaceFunding;
  if (payment.merchantId !== host || plan.hostMerchantId !== host || plan.paymentIntentId !== payment.id ||
      !payment.sessionId?.trim() || !plan.checkoutSessionId?.trim() || !Number.isSafeInteger(payment.version) || payment.version < 0 ||
      payment.providerPaymentId !== null || plan.providerPaymentId !== null || payment.approvedAmountCents !== null ||
      !record(creation) || creation.state !== "ready" || creation.firstAttemptAt !== undefined ||
      creation.leaseToken !== undefined || creation.leaseUntil !== undefined || creation.reason !== undefined ||
      !record(input) || !record(instructions) || !record(input.marketplaceFunding) ||
      input.intentId !== payment.id || input.merchantId !== host || input.sessionId !== payment.sessionId ||
      input.provider !== plan.provider || input.providerAccountFingerprint !== plan.accountFingerprint || input.method !== payment.method ||
      input.amountCents !== payment.amountCents || input.currency !== payment.currency ||
      input.stripeConnectAccountId || input.merchantPayoutDestination || input.settlementMode ||
      fundingHash(input.marketplaceFunding) !== plan.instructionsHash || fundingHash(instructions) !== plan.instructionsHash ||
      instructions.hostMerchantId !== host || instructions.provider !== plan.provider || instructions.environment !== plan.environment ||
      instructions.accountFingerprint !== plan.accountFingerprint || instructions.amountCents !== plan.amountCents ||
      instructions.currency !== "BRL" || payment.currency !== "BRL" || plan.amountCents !== payment.amountCents ||
      !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 ||
      plan.budget !== null || plan.fundedAt !== null || plan.providerFeeCents !== null || plan.netAmountCents !== null ||
      plan.platformRetainedCents !== null || plan.payoutTotalCents !== null ||
      payment.commerceOrderId !== null || payment.acceptedOfferId !== null || !empty(payment.buyerFacing)) throw conflict();
  try { assertMarketplaceUncapturedAllocation(instructions); } catch { throw conflict(); }
  const rawHistory: unknown = payment.statusHistory;
  if (!Array.isArray(rawHistory) || !rawHistory.length || rawHistory.some((row: unknown) => !record(row) ||
      typeof row.occurredAt !== "string" || !Number.isFinite(Date.parse(row.occurredAt)))) throw conflict();
  const history = rawHistory as Array<Record<string, unknown>>;
  const lineIds = instructions.lines.map(row => row.lineItemId);
  if (await reader.marketplacePayout.count({ where: { fundingPlanId: id } }) ||
      await reader.marketplaceSettlement.count({ where: { hostMerchantId: host, lineItemId: { in: lineIds } } }) ||
      await reader.marketplaceOrderLedger.count({ where: { hostMerchantId: host, checkoutSessionId: plan.checkoutSessionId } }) ||
      await reader.completedOrder.count({ where: { merchantId: host, sessionId: payment.sessionId } }) ||
      await reader.marketplaceShipmentJournal.count({ where: { fundingPlanId: id } }) ||
      await reader.marketplaceCancellationOperation.count({ where: { fundingPlanId: id } }) ||
      await reader.marketplaceRefundPlan.count({ where: { fundingPlanId: id } }) ||
      await reader.marketplaceResidualPlan.count({ where: { fundingPlanId: id } })) throw conflict();
  const items = await reader.crossStoreLineItem.findMany({ where: { hostMerchantId: host, checkoutSessionId: plan.checkoutSessionId } });
  if (items.some(row => row.orderId || row.purchasedAt || row.fulfillmentStatus !== "pending" ||
      !Number.isSafeInteger(row.quantity) || row.quantity <= 0 || !row.sourceVariantId) ||
      items.length !== instructions.lines.filter(row => row.sellerMerchantId !== host).length || items.some(row =>
        !instructions.lines.some(line => line.lineItemId === row.id && line.sellerMerchantId === row.sellerMerchantId &&
          line.grossAmountCents === row.unitPriceCents * row.quantity && line.commissionCents === row.commissionCents))) throw conflict();
  const own = instructions.hostStockItems ?? [], ownLines = instructions.lines.filter(row => row.sellerMerchantId === host);
  if (own.length !== ownLines.length || new Set(own.map(row => row.lineItemId)).size !== own.length ||
      own.some(row => !ownLines.some(line => line.lineItemId === row.lineItemId) || !row.variantId?.trim() ||
        !Number.isSafeInteger(row.quantity) || row.quantity <= 0 || typeof row.requiresStock !== "boolean")) throw conflict();
  if (lockVariants) for (const variant of [...new Set([...own.map(row => row.variantId), ...items.map(row => row.sourceVariantId!)])].sort()) {
    await reader.$queryRaw`SELECT id FROM product_variants WHERE id = ${variant} FOR UPDATE`;
  }
  const holds = await reader.stockReservation.findMany({ where: { marketplaceFundingPlanId: id }, orderBy: { id: "asc" } });
  const expected = [...own.filter(row => row.requiresStock).map(row => ({ cartId: row.lineItemId, variantId: row.variantId,
    quantity: row.quantity, id: undefined as string | undefined })), ...items.filter(row => row.stockReservationId).map(row => ({
      cartId: row.id, variantId: row.sourceVariantId!, quantity: row.quantity, id: row.stockReservationId! }))];
  if (holds.length !== expected.length || expected.some(row => holds.filter(hold => hold.cartId === row.cartId &&
      hold.variantId === row.variantId && hold.quantity === row.quantity && (!row.id || row.id === hold.id)).length !== 1) ||
      holds.some(hold => !hold.stockId || !Number.isSafeInteger(hold.quantity) || hold.quantity <= 0)) throw conflict();
  return { payment, plan, input, holds, history };
}

type State = Awaited<ReturnType<typeof state>>;
const reservationsHash = (holds: State["holds"]) => fundingHash(holds.map(({ id, variantId, stockId, cartId, quantity }) =>
  ({ id, variantId, stockId, cartId, quantity })));
type Receipt = NonNullable<Awaited<ReturnType<Prisma.TransactionClient["outboxMessage"]["findUnique"]>>>;
function receiptStatus(current: State, receipt: Receipt): { reason: MarketplaceCancellationReason } {
  const { payment, plan, input, holds, history } = current;
  const payload: unknown = receipt.payload;
  const proof = record(payload) ? payload.marketplace_local_cancellation : null;
  const last = history.at(-1);
  if (!record(payload) || !record(proof) || proof.version !== 1 || proof.kind !== "never_submitted" ||
      proof.hostMerchantId !== plan.hostMerchantId || proof.paymentIntentId !== payment.id || proof.checkoutSessionId !== payment.sessionId ||
      proof.cartRef !== plan.checkoutSessionId || proof.instructionsHash !== plan.instructionsHash || proof.creationInputHash !== fundingHash(input) ||
      proof.reservationsHash !== reservationsHash(holds) ||
      proof.provider !== plan.provider || proof.environment !== plan.environment || proof.accountFingerprint !== plan.accountFingerprint ||
      proof.amountCents !== payment.amountCents || proof.currency !== "BRL" || !reasons.includes(proof.reason) ||
      !Number.isSafeInteger(proof.paymentVersionBefore) || proof.paymentVersionBefore < 0 || payment.version !== proof.paymentVersionBefore + 1 ||
      typeof proof.cancelledAt !== "string" || !Number.isFinite(Date.parse(proof.cancelledAt)) ||
      receipt.occurredAt.toISOString() !== proof.cancelledAt || receipt.eventId !== marketplaceUnsubmittedCancellationEventId(payment.id) ||
      receipt.merchantId !== plan.hostMerchantId || receipt.eventType !== "payment.status.changed" || receipt.schemaVersion !== 1 ||
      receipt.producer !== "marketplace" || receipt.correlationId !== payment.id || receipt.causationId !== payment.id ||
      payload.reason !== MARKETPLACE_UNSUBMITTED_CANCELLATION_REASON || payload.status !== "cancelled" ||
      payload.payment_intent_id !== payment.id || payload.session_id !== payment.sessionId || payload.amount_cents !== payment.amountCents ||
      payload.method !== payment.method || payload.commerce_order_id !== null || payload.marketplace_cancellation !== undefined ||
      payment.status !== "cancelled" || plan.status !== "held" || holds.some(row => row.status !== "RELEASED") ||
      history.length < 2 || history.slice(0, -1).some(row => !record(row) || row.status !== "pending") ||
      !record(last) || last.status !== "cancelled" ||
      last.reason !== MARKETPLACE_UNSUBMITTED_CANCELLATION_REASON || last.occurredAt !== proof.cancelledAt) throw conflict();
  return { reason: proof.reason as MarketplaceCancellationReason };
}

/** No transaction or locks are opened here. Audits may reuse their consistent
 * RepeatableRead snapshot; a missing receipt always leaves the PSP path alone. */
export async function readMarketplaceUnsubmittedCancellationStatus(reader: Prisma.TransactionClient, host: string, id: string) {
  const receipt = await reader.outboxMessage.findUnique({ where: { eventId: marketplaceUnsubmittedCancellationEventId(id) } });
  if (!receipt) return null;
  try { return receiptStatus(await state(reader, host, id), receipt); } catch { throw conflict(); }
}

@Injectable()
export class PrismaMarketplaceUnsubmittedCancellationRepository implements MarketplaceUnsubmittedCancellationRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  status(host: string, id: string): Promise<{ reason: MarketplaceCancellationReason } | null> {
    return this.prisma.$transaction(tx => readMarketplaceUnsubmittedCancellationStatus(tx, host, id), { isolationLevel: "RepeatableRead" });
  }

  async cancel(host: string, id: string, reason: MarketplaceCancellationReason): Promise<"released" | "not_applicable"> {
    if (!host?.trim() || !id?.trim() || !reasons.includes(reason)) throw conflict();
    return this.prisma.$transaction(async tx => {
      const first = await tx.paymentIntent.findFirst({ where: { id, merchantId: host } });
      const firstPlan = first && await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: id, hostMerchantId: host } });
      if (!first || !firstPlan) throw new NotFoundException("marketplace_payment_not_found");
      // Match checkout writers and first-send admission, then protect the journal
      // version against an internal sender that does not need the checkout lock.
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${host} AND session_id = ${first.sessionId} FOR UPDATE`;
      for (const ref of [...new Set([first.sessionId, firstPlan.checkoutSessionId])].sort()) {
        const key = JSON.stringify(["storefront-cart", host, ref]);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
      }
      await tx.$queryRaw`SELECT payment_intent_id FROM marketplace_funding_plans WHERE payment_intent_id = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM payment_intents WHERE id = ${id} FOR UPDATE`;
      const receipt = await tx.outboxMessage.findUnique({ where: { eventId: marketplaceUnsubmittedCancellationEventId(id) } });
      if (receipt) {
        const result = receiptStatus(await state(tx, host, id, true), receipt);
        if (result.reason !== reason) throw conflict();
        return "released";
      }
      const payment = await tx.paymentIntent.findFirst({ where: { id, merchantId: host } });
      if (typeof payment?.providerPaymentId === "string" && payment.providerPaymentId.trim()) return "not_applicable";
      if (!payment || !isNeverSubmittedMarketplacePayment(payment)) throw conflict();
      const current = await state(tx, host, id, true), { plan, holds, history, input } = current;
      if (plan.status !== "awaiting_capture" || holds.some(row => row.status !== "ACTIVE")) throw conflict();
      const now = new Date(), proof: MarketplaceUnsubmittedCancellationProof = {
        version: 1, kind: "never_submitted", hostMerchantId: host, paymentIntentId: id, checkoutSessionId: payment.sessionId,
        cartRef: plan.checkoutSessionId, instructionsHash: plan.instructionsHash, creationInputHash: fundingHash(input),
        reservationsHash: reservationsHash(holds),
        provider: plan.provider, environment: plan.environment, accountFingerprint: plan.accountFingerprint,
        amountCents: payment.amountCents, currency: "BRL", paymentVersionBefore: payment.version, reason, cancelledAt: now.toISOString(),
      };
      const changed = await tx.paymentIntent.updateMany({ where: { id, merchantId: host, version: payment.version,
        status: "pending", providerPaymentId: null, approvedAmountCents: null }, data: { status: "cancelled", version: { increment: 1 },
        buyerFacing: {}, statusHistory: [...history, { status: "cancelled", occurredAt: proof.cancelledAt,
          reason: MARKETPLACE_UNSUBMITTED_CANCELLATION_REASON }] as Prisma.InputJsonValue } });
      if (changed.count !== 1) throw conflict();
      for (const hold of holds) {
        const stock = await tx.productStock.updateMany({ where: { id: hold.stockId!, variantId: hold.variantId, reserved: { gte: hold.quantity } },
          data: { reserved: { decrement: hold.quantity } } });
        if (stock.count !== 1) throw conflict();
        const released = await tx.stockReservation.updateMany({ where: { id: hold.id, status: "ACTIVE", marketplaceFundingPlanId: id,
          stockId: hold.stockId, variantId: hold.variantId, quantity: hold.quantity }, data: { status: "RELEASED" } });
        if (released.count !== 1) throw conflict();
      }
      const held = await tx.marketplaceFundingPlan.updateMany({ where: { paymentIntentId: id, hostMerchantId: host,
        status: "awaiting_capture", providerPaymentId: null, instructionsHash: plan.instructionsHash }, data: { status: "held" } });
      if (held.count !== 1) throw conflict();
      await tx.outboxMessage.create({ data: { eventId: marketplaceUnsubmittedCancellationEventId(id), eventType: "payment.status.changed",
        schemaVersion: 1, merchantId: host, occurredAt: now, correlationId: id, causationId: id, producer: "marketplace",
        payload: { session_id: payment.sessionId, payment_intent_id: id, status: "cancelled", amount_cents: payment.amountCents,
          method: payment.method, commerce_order_id: null, reason: MARKETPLACE_UNSUBMITTED_CANCELLATION_REASON,
          marketplace_local_cancellation: proof } as unknown as Prisma.InputJsonValue } });
      return "released";
    });
  }
}
