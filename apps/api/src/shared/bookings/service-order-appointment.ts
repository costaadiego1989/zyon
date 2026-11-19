import { readProfessionalCheckoutSelections, type ProfessionalCheckoutSelection } from "./service-checkout-selection.js";
import { ConflictException, BadRequestException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { CompletedOrder, Prisma, ServiceAppointment } from "@prisma/client";
import type { CompletedOrderLineItem } from "@zyon/shared-types";
import { admitServiceAppointment } from "./service-appointment-admission.service.js";
import { serviceSlotStore, type RedisServiceSlots } from "./redis-service-slots.js";
import { readManualServicePaymentWithin } from "./manual-service-payment-continuation.js";
import { fulfillmentPaymentEligible } from "../persistence/order-fulfillment.js";
import { lockCatalogMerchant } from "../persistence/catalog-stock-ledger.js";
import { lockServiceProfessional } from "./service-professional-lock.js";
import { readStoredServiceOrigin } from "./service-checkout-provenance.js";
import { admitWhatsAppEffectInTransaction } from "../whatsapp/whatsapp-automation-context.js";
export { readStoredServiceOrigin } from "./service-checkout-provenance.js";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function professionalOrderLine(order: Pick<CompletedOrder, "lineItemsJson">, unitId: string): CompletedOrderLineItem | undefined {
  const lines = Array.isArray(order.lineItemsJson) ? order.lineItemsJson.filter(v => record(v) && v.lineId === unitId) : [];
  if (!lines.length) return undefined;
  if (lines.length !== 1 || !record(lines[0])) throw new ConflictException("service_order_unit_ambiguous");
  const line = lines[0], s = line.schedule;
  if (!record(s) || !["professionalId", "professionalVersion", "policyVersion"].some(k => Object.hasOwn(s, k))) return undefined;
  if (line.snapshotVersion !== 2 || line.productType !== "service" || line.fulfillmentStrategy !== "scheduled_service" || line.quantity !== 1
    || typeof line.variantId !== "string" || typeof s.professionalId !== "string" || !s.professionalId
    || !Number.isSafeInteger(s.professionalVersion) || Number(s.professionalVersion) < 1
    || !Number.isSafeInteger(s.policyVersion) || Number(s.policyVersion) < 1 || typeof s.date !== "string"
    || typeof s.startsAt !== "string" || typeof s.endsAt !== "string" || typeof s.timeZone !== "string"
    || !Number.isSafeInteger(s.durationMinutes) || !Number.isSafeInteger(line.unitPriceCents))
    throw new ConflictException("service_order_snapshot_invalid");
  return line as unknown as CompletedOrderLineItem;
}
export function serviceProjectionStatus(status: ServiceAppointment["operationalStatus"]): string {
  return status === "scheduled" || status === "in_service" ? "reserved" : status === "pending" ? "cancelled" : status;
}
/** Immutable approved order selector; today's checkout cart is not historical
 * capacity evidence. Reuse the real structural parser and tenant SQL identity. */
export async function readOrderProfessionalSelectionsWithin(tx: Prisma.TransactionClient, order: CompletedOrder): Promise<ProfessionalCheckoutSelection[]> {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function") throw new BadRequestException("service_order_transaction_required");
  const lines: CompletedOrderLineItem[] = [];
  for (const raw of Array.isArray(order.lineItemsJson) ? order.lineItemsJson : []) {
    if (!record(raw)) continue;
    if (typeof raw.lineId !== "string") {
      const schedule = raw.schedule;
      if (record(schedule) && ["professionalId", "professionalVersion", "policyVersion"].some(k => Object.hasOwn(schedule, k)))
        throw new ConflictException("service_order_snapshot_invalid");
      continue;
    }
    const line = professionalOrderLine(order, raw.lineId); if (line) lines.push(line);
  }
  const variants = await tx.productVariant.findMany({ where: { id: { in: [...new Set(lines.map(line => line.variantId!))] }, product: { merchantId: order.merchantId } },
    select: { id: true, productId: true } });
  const items = lines.map(line => {
    const variant = variants.find(v => v.id === line.variantId); if (!variant) throw new ConflictException("service_order_variant_not_found");
    return { sku: line.sku, name: line.name ?? line.sku, product_id: variant.productId, variantId: variant.id, quantity: 1,
      price: line.unitPriceCents / 100, productType: "service" as const, fulfillmentStrategy: "scheduled_service" as const, fulfillmentSchedule: line.schedule };
  });
  return readProfessionalCheckoutSelections({ merchantId: order.merchantId, cart: { currency: order.currency, items } });
}

/** Existing callers may translate domain refusal to attention/regularization.
 * Roll back this unit first, including any post-admission/projection failure.
 * Static savepoint names contain no caller text; the outer owner keeps its
 * original transaction options, merchant lock and payment fact. */
interface OrderAdmissionContext { store?: () => Pick<RedisServiceSlots, "acquire" | "assertActive" | "get" | "release" | "assertCapturedActive"> }
export async function reserveProfessionalOrderUnit(tx: Prisma.TransactionClient, merchantId: string, orderId: string, unitId: string, context: OrderAdmissionContext = {}) {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function") throw new BadRequestException("service_order_transaction_required");
  await admitWhatsAppEffectInTransaction(tx, merchantId); await lockCatalogMerchant(tx, merchantId);
  await tx.$executeRawUnsafe("SAVEPOINT service_professional_order_unit_v1");
  try {
    const result = await reserveProfessionalOrderUnitWithin(tx, merchantId, orderId, unitId, context);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT service_professional_order_unit_v1"); return result;
  } catch (error) {
    try {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT service_professional_order_unit_v1");
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT service_professional_order_unit_v1");
    } catch (rollback) { throw new AggregateError([error, rollback], "service_order_unit_rollback_failed"); }
    throw error;
  }
}
/** No new capacity authority. Admission remains T26; an optional legacy row is
 * only a projection of the CURRENT appointment, including moved/terminal state. */
async function reserveProfessionalOrderUnitWithin(tx: Prisma.TransactionClient, merchantId: string, orderId: string, unitId: string, context: OrderAdmissionContext) {
  const order = await tx.completedOrder.findFirstOrThrow({ where: { id: orderId, merchantId } });
  const line = professionalOrderLine(order, unitId); if (!line?.schedule?.professionalId || !line.variantId) throw new ConflictException("service_order_professional_required");
  const payment = await tx.paymentIntent.findFirst({ where: { merchantId, sessionId: order.sessionId, providerPaymentId: order.externalOrderId, status: "approved" } });
  if (!fulfillmentPaymentEligible(order, payment)) throw new ConflictException("fulfillment_payment_required");
  let appointment = await tx.serviceAppointment.findUnique({ where: { merchantId_orderId_orderUnitId: { merchantId, orderId, orderUnitId: unitId } } });
  let replayed = true;
  if (!appointment) {
    const old = await tx.serviceReservation.findUnique({ where: { orderId_unitId: { orderId, unitId } } });
    // T26's readiness guard must continue to see this unclassified row. Do not
    // temporarily relabel/delete it to admit over historical capacity.
    if (old) throw new ConflictException("service_legacy_classification_required");
    const leaseSelections = await readOrderProfessionalSelectionsWithin(tx, order);
    for (const professionalId of [...new Set(leaseSelections.map(s => s.professionalId))].sort()) await lockServiceProfessional(tx, merchantId, professionalId);
    const manual = await readManualServicePaymentWithin(tx, { merchantId, paymentIntentId: payment!.id, unitId });
    const checkout = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: order.sessionId } } });
    if (!checkout || !checkout.globalUserId || !record(checkout.customer)) throw new ConflictException("service_order_customer_unproven");
    const origin = manual ? "manual" : readStoredServiceOrigin(checkout);
    const selected = leaseSelections.find(s => s.variantId === line.variantId && s.startsAt === line.schedule!.startsAt
      && s.professionalId === line.schedule!.professionalId);
    if (!selected) throw new ConflictException("service_order_snapshot_invalid");
    const c = manual ? manual.appointment.customerSnapshot : checkout.customer;
    if (!record(c)) throw new ConflictException("service_order_customer_unproven");
    const customer = manual ? { name: typeof c.name === "string" ? c.name : "", ...(typeof c.phone === "string" ? { phone: c.phone } : {}),
      ...(typeof c.email === "string" ? { email: c.email } : {}) }
      : { name: typeof c.fullName === "string" ? c.fullName : "", ...(typeof c.phone === "string" ? { phone: c.phone } : {}),
        ...(typeof c.email === "string" ? { email: c.email } : {}) };
    const buyerGlobalUserId = manual ? manual.appointment.buyerGlobalUserId ?? undefined : checkout.globalUserId;
    const result = await admitServiceAppointment(tx, { merchantId, productId: selected.productId, variantId: selected.variantId,
      professionalId: selected.professionalId, professionalVersion: selected.professionalVersion, policyVersion: selected.policyVersion, date: selected.date,
      startsAt: selected.startsAt, endsAt: selected.endsAt, priceInCents: selected.priceInCents, currency: selected.currency,
      customer, ...(buyerGlobalUserId ? { buyerGlobalUserId } : {}), actorId: manual?.operatorId ?? checkout.globalUserId, origin,
      idempotencyKey: "order-unit:" + createHash("sha256").update(JSON.stringify([merchantId, order.id, unitId])).digest("hex"),
      confirmation: { kind: "approved_order_unit", orderId, unitId } }, { leaseOwner: { ownerId: order.sessionId, store: context.store ?? serviceSlotStore },
      leaseSelections, ...(manual ? { pendingPaymentRecordId: manual.payment.id, capturedLeaseStore: context.store ?? serviceSlotStore } : {}) });
    appointment = result.appointment; replayed = result.replayed;
    if (!manual && !replayed) {
      const fingerprint = createHash("sha256").update(JSON.stringify(["approved-service-unit-v1", merchantId, payment!.id, unitId, appointment.id])).digest("hex");
      await tx.appointmentPayment.create({ data: { merchantId, appointmentId: appointment.id, paymentIntentId: payment!.id,
        mode: "online", status: "approved", amountCents: appointment.priceInCents, currency: appointment.currency,
        providerPaymentId: payment!.providerPaymentId, providerEvidence: { paymentIntentId: payment!.id,
          approvedAmountCents: payment!.approvedAmountCents, currency: payment!.currency, unitId }, receivedAt: appointment.confirmedAt,
        idempotencyKey: "approved-service:" + fingerprint, requestFingerprint: fingerprint } });
    }
  }
  if (replayed) await lockServiceProfessional(tx, merchantId, appointment.professionalId);
  // Original paid order coordinates never overwrite a later operator reschedule.
  const data = { resourceId: appointment.variantId, startsAt: appointment.startsAt, endsAt: appointment.endsAt,
    appointmentId: appointment.id, classificationPending: false, status: serviceProjectionStatus(appointment.operationalStatus) };
  await tx.serviceReservation.upsert({ where: { orderId_unitId: { orderId, unitId } },
    create: { id: randomUUID(), merchantId, orderId, unitId, ...data }, update: data });
  return { appointment, replayed };
}
