import { createHash, randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CompletedOrder } from "@prisma/client";
import { orderTotalCents, type PaymentAmountBreakdown } from "../../modules/payment/domain/payment-amount.js";
import { initialFulfillment, readFulfillment, summarizeFulfillment, type FulfillmentState } from "../../modules/operations/domain/order-fulfillment.js";
import type { CompletedOrderLineItem, OrderFulfillmentUnit as Unit } from "@zyon/shared-types";
import { serviceSlotStore } from "../bookings/redis-service-slots.js";

type Payment = { status: string; amountCents: number; approvedAmountCents: number | null; currency: string; amountBreakdown?: unknown; providerPaymentId?: string | null };
export function fulfillmentPaymentEligible(order: { orderTotal: unknown; currency: string; externalOrderId: string }, payment?: Payment | null): boolean {
  if (!payment || payment.status !== "approved" || payment.approvedAmountCents !== payment.amountCents || payment.currency !== order.currency || payment.providerPaymentId !== order.externalOrderId) return false;
  try { return Math.round(Number(order.orderTotal) * 100) === orderTotalCents(payment.amountBreakdown as PaymentAmountBreakdown | undefined, payment.amountCents); } catch { return false; }
}
export async function reserveService(tx: Prisma.TransactionClient, order: CompletedOrder, unit: Unit): Promise<void> {
  if (!unit.schedule || unit.quantity !== 1) throw new ConflictException("service_schedule_required");
  const startsAt = new Date(unit.schedule.startsAt), endsAt = new Date(unit.schedule.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new ConflictException("service_schedule_invalid");
  // Capacity one per canonical variant; the same lock protects overlapping slots.
  await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`${order.merchantId}:service:${unit.variantId}`}, 0))`);
  await serviceSlotStore().assertNoForeignHold(order.merchantId, unit.variantId, order.sessionId, startsAt, endsAt);
  const conflict = await tx.serviceReservation.findFirst({ where: { merchantId: order.merchantId, resourceId: unit.variantId, status: "reserved",
    NOT: { orderId: order.id, unitId: unit.id }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
    order: { status: { notIn: ["cancelled", "refunded", "returned", "failed"] } } } });
  if (conflict) throw new ConflictException("service_capacity_unavailable");
  await tx.serviceReservation.upsert({ where: { orderId_unitId: { orderId: order.id, unitId: unit.id } },
    create: { id: randomUUID(), merchantId: order.merchantId, orderId: order.id, unitId: unit.id, resourceId: unit.variantId, startsAt, endsAt },
    update: { resourceId: unit.variantId, startsAt, endsAt, status: "reserved" } });
}
export async function initializeOrderFulfillment(tx: Prisma.TransactionClient, orderId: string, merchantId: string): Promise<void> {
  const order = await tx.completedOrder.findFirstOrThrow({ where: { id: orderId, merchantId } });
  if (order.fulfillmentJson) return;
  const state = initialFulfillment(order.lineItemsJson as unknown as CompletedOrderLineItem[] | undefined);
  if (!state) return;
  const payment = await tx.paymentIntent.findFirst({ where: { merchantId, sessionId: order.sessionId, providerPaymentId: order.externalOrderId, status: "approved" } });
  const contents = Array.isArray(payment?.digitalContent) ? payment!.digitalContent as Array<{ variantId?: string; requiredChannels?: string[] }> : [];
  for (const unit of state.units) {
    if (unit.strategy === "digital") unit.requiredChannels = contents.find(content => content.variantId === unit.variantId)?.requiredChannels ?? unit.requiredChannels ?? ["email"];
    if (unit.schedule && fulfillmentPaymentEligible(order, payment)) {
      try { await reserveService(tx, order, unit); }
      catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        // Preserve the approved purchase when its appointment needs resolution.
        unit.attention = "service_capacity_unavailable";
      }
    }
  }
  await tx.completedOrder.update({ where: { id: order.id }, data: { fulfillmentJson: state as unknown as Prisma.InputJsonValue } });
}
export async function lockFulfillmentOrder(tx: Prisma.TransactionClient, merchantId: string, orderId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM completed_orders WHERE id = ${orderId} AND merchant_id = ${merchantId} FOR UPDATE`);
  const order = await tx.completedOrder.findFirst({ where: { id: orderId, merchantId } });
  if (!order) throw new NotFoundException("order_not_found");
  return order;
}
export async function persistFulfillmentTransition(tx: Prisma.TransactionClient, order: CompletedOrder, state: FulfillmentState, input: {
  unitId: string; action: string; commandId: string; actorId: string; origin: string; fromStatus: string; toStatus: string; quantity: number; proof?: string; fingerprint?: string;
}): Promise<void> {
  const now = new Date();
  const allDone = state.units.every(unit => unit.completedQuantity === unit.quantity);
  const changed = await tx.completedOrder.updateMany({ where: { id: order.id, merchantId: order.merchantId, fulfillmentVersion: order.fulfillmentVersion }, data: {
    fulfillmentJson: state as unknown as Prisma.InputJsonValue, fulfillmentVersion: { increment: 1 },
    ...(allDone && !order.fulfilledAt ? { fulfilledAt: now } : {}),
  } });
  if (changed.count !== 1) throw new ConflictException("fulfillment_version_conflict");
  await tx.orderFulfillmentAction.create({ data: { id: randomUUID(), merchantId: order.merchantId, orderId: order.id,
    ...input, fingerprint: input.fingerprint ?? input.commandId, occurredAt: now } });
  const version = order.fulfillmentVersion + 1;
  for (const eventType of ["order.fulfillment.updated", ...(allDone && !order.fulfilledAt ? ["order.fulfillment.completed"] : [])]) {
    const eventId = createHash("sha256").update(`${order.merchantId}:${order.id}:${version}:${eventType}`).digest("hex");
    await tx.outboxMessage.create({ data: { eventId, merchantId: order.merchantId, eventType, schemaVersion: 1, producer: "operations",
      correlationId: order.id, causationId: input.commandId, occurredAt: now,
      payload: { orderId: order.id, externalOrderId: order.externalOrderId, sessionId: order.sessionId, version,
        stage: summarizeFulfillment(state, version, true, order.status).stage,
        unitId: input.unitId, action: input.action, completedQuantity: state.units.reduce((total, unit) => total + unit.completedQuantity, 0),
        totalQuantity: state.units.reduce((total, unit) => total + unit.quantity, 0),
        unit: { sku: state.units.find(unit => unit.id === input.unitId)?.sku ?? "", fromStatus: input.fromStatus, toStatus: input.toStatus, quantity: input.quantity },
        productTypes: [...new Set(state.units.map(unit => unit.productType))] } } });
  }
}
export async function projectDigitalFulfillment(tx: Prisma.TransactionClient, merchantId: string, orderId: string): Promise<void> {
  const order = await lockFulfillmentOrder(tx, merchantId, orderId);
  const state = readFulfillment(order.fulfillmentJson);
  if (!state || ["cancelled", "refunded", "returned", "failed"].includes(order.status)) return;
  const payment = await tx.paymentIntent.findFirst({ where: { merchantId, sessionId: order.sessionId, providerPaymentId: order.externalOrderId, status: "approved" } });
  if (!fulfillmentPaymentEligible(order, payment)) return;
  const grants = await tx.digitalEntitlement.findMany({ where: { merchantId, orderId }, include: { deliveries: true } });
  for (const unit of state.units.filter(unit => unit.strategy === "digital")) {
    const grant = grants.find(grant => grant.variantId === unit.variantId);
    const refunded = grant && await tx.return.findFirst({ where: { merchantId, orderId: order.externalOrderId, items: { some: { variantId: unit.variantId } }, refund: { is: { status: "COMPLETED" } } }, select: { id: true } });
    const required = unit.requiredChannels ?? ["email"];
    const available = grant?.status === "active" && grant.expiresAt > new Date() && !refunded;
    const sent = available && required.length > 0 && required.every(channel => grant!.deliveries.some(delivery => delivery.channel === channel && delivery.status === "sent" && !!delivery.providerId));
    const attention = !available ? "digital_access_unavailable" : required.some(channel => !grant!.deliveries.some(delivery => delivery.channel === channel)) ? "digital_required_channel_missing"
      : grant!.deliveries.find(delivery => required.includes(delivery.channel) && ["blocked", "uncertain"].includes(delivery.status))?.reason ?? undefined;
    const next = sent ? "available" : "provisioning";
    if (unit.status === next && unit.attention === attention) continue;
    const fromStatus = unit.status;
    unit.status = next; unit.completedQuantity = sent ? unit.quantity : 0;
    if (attention) unit.attention = attention; else delete unit.attention;
    await persistFulfillmentTransition(tx, order, state, { unitId: unit.id, action: "digital_provider_result", commandId: `digital:${order.id}:${order.fulfillmentVersion + 1}:${unit.id}`,
      actorId: "digital_delivery", origin: "automation", fromStatus, toStatus: next, quantity: sent ? unit.quantity : 0 });
    order.fulfillmentVersion++; if (state.units.every(unit => unit.completedQuantity === unit.quantity)) order.fulfilledAt = new Date();
  }
}
