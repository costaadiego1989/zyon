import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { toCheckoutSession } from "../domain/services/checkout-session-projection.js";
import { paymentCartFingerprint } from "../domain/services/payment-cart-fingerprint.js";
import { lockCheckoutSessionAnchor } from "../../../shared/persistence/checkout-session-lock.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import { readProfessionalCheckout } from "../../../shared/bookings/read-professional-checkout.js";
import { admitServiceAppointment } from "../../../shared/bookings/service-appointment-admission.service.js";
import { retainAppointmentLease } from "../../../shared/bookings/appointment-lease-proof.js";
import { ensureAtAttendancePayment } from "../../../shared/bookings/service-at-attendance-payment.js";
import { serviceSlotStore } from "../../../shared/bookings/redis-service-slots.js";
import type { ProfessionalLeaseStore } from "../../../shared/bookings/professional-service-lease.js";
import { admitWhatsAppEffectInTransaction } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { assertNoActiveServiceCheckoutPayment } from "../../../shared/bookings/service-booking-active-payment.js";

/** The channel resolves this identity; never deserialize it from buyer input. */
export interface ServiceCheckoutBuyer { merchantId: string; sessionId: string; globalUserId: string; origin: "whatsapp" | "storefront" }
export interface ServiceCheckoutEmbedCapability { merchantId: string; sessionId: string; expiresAtUnix: number; allowedOrigin: string; scope: "appointments:confirm" }
export interface ConfirmServiceAppointmentCommand { commandId: string; cartFingerprint: string }
interface ConfirmationContext { clock?: () => Date; store?: () => ProfessionalLeaseStore }
type Principal = { kind: "buyer"; buyer: ServiceCheckoutBuyer } | { kind: "embed"; capability: ServiceCheckoutEmbedCapability };
type AppointmentWithPayments = Prisma.ServiceAppointmentGetPayload<{ include: { payments: true } }>;

function decisionClock(context: ConfirmationContext, capability?: ServiceCheckoutEmbedCapability) {
  const now = context.clock ? context.clock() : new Date();
  if (!Number.isFinite(now.getTime())) throw new BadRequestException("service_confirmation_invalid_clock");
  if (capability && now.getTime() >= capability.expiresAtUnix * 1000)
    throw new UnauthorizedException("embed_session_token_expired");
  return now;
}

async function confirmWithin(tx: Prisma.TransactionClient, principal: Principal,
  input: ConfirmServiceAppointmentCommand, context: ConfirmationContext) {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function")
    throw new BadRequestException("service_confirmation_transaction_required");
  if (!input || typeof input.commandId !== "string" || !input.commandId.trim() || input.commandId.length > 191
    || typeof input.cartFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.cartFingerprint))
    throw new BadRequestException("service_confirmation_invalid");
  const scope = principal.kind === "buyer" ? principal.buyer : principal.capability;
  if (!scope.merchantId || !scope.sessionId) throw new ForbiddenException("service_checkout_buyer_required");
  if (principal.kind === "buyer" && (!principal.buyer.globalUserId || !["whatsapp", "storefront"].includes(principal.buyer.origin)))
    throw new ForbiddenException("service_checkout_buyer_required");
  const capability = principal.kind === "embed" ? principal.capability : undefined;
  if (capability && (capability.scope !== "appointments:confirm" || !capability.allowedOrigin?.trim()
    || !Number.isSafeInteger(capability.expiresAtUnix) || capability.expiresAtUnix <= 0))
    throw new ForbiddenException("embed_service_confirmation_capability_invalid");
  await admitWhatsAppEffectInTransaction(tx, scope.merchantId);
  await lockCatalogMerchant(tx, scope.merchantId);
  await lockCheckoutSessionAnchor(tx, scope.merchantId, scope.sessionId);
  await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${scope.merchantId} AND session_id = ${scope.sessionId} FOR UPDATE`;
  const row = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.sessionId } } });
  if (!row) throw new NotFoundException("checkout_session_not_found");
  const buyer: ServiceCheckoutBuyer = principal.kind === "buyer" ? principal.buyer
    : { merchantId: scope.merchantId, sessionId: scope.sessionId, globalUserId: row.globalUserId, origin: "storefront" };
  if (!buyer.globalUserId || row.globalUserId !== buyer.globalUserId) throw new ForbiddenException("service_checkout_buyer_mismatch");
  const fingerprint = createHash("sha256").update(JSON.stringify(["service-checkout-confirm-v1", buyer.merchantId,
    buyer.sessionId, buyer.globalUserId, buyer.origin, input.cartFingerprint])).digest("hex");
  const prior = await tx.appointmentAudit.findUnique({ where: { merchantId_commandId: { merchantId: buyer.merchantId, commandId: input.commandId } } });
  if (prior) {
    decisionClock(context, capability);
    const receipt = prior.after;
    if (prior.action !== "checkout_confirm" || !receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || receipt.requestFingerprint !== fingerprint || receipt.checkoutSessionId !== buyer.sessionId
      || receipt.cartFingerprint !== input.cartFingerprint || !Array.isArray(receipt.appointmentIds) || !receipt.appointmentIds.length
      || !receipt.appointmentIds.every((id): id is string => typeof id === "string")
      || new Set(receipt.appointmentIds).size !== receipt.appointmentIds.length)
      throw new ConflictException("service_appointment_idempotency_conflict");
    const appointments = await tx.serviceAppointment.findMany({ where: { merchantId: buyer.merchantId,
      buyerGlobalUserId: buyer.globalUserId, id: { in: receipt.appointmentIds } }, include: { payments: true } });
    if (appointments.length !== receipt.appointmentIds.length) throw new ConflictException("service_confirmation_receipt_invalid");
    const byId = new Map(appointments.map(appointment => [appointment.id, appointment]));
    return { appointments: receipt.appointmentIds.map(id => byId.get(id)!), replayed: true };
  }
  if (await tx.completedOrder.findFirst({ where: { merchantId: buyer.merchantId, sessionId: buyer.sessionId } }))
    throw new ConflictException("service_checkout_already_ordered");
  const session = toCheckoutSession(row);
  if (paymentCartFingerprint(session) !== input.cartFingerprint) throw new ConflictException("service_checkout_summary_changed");
  if (session.cart.items.some(item => item.productType !== "service" || item.fulfillmentStrategy !== "scheduled_service"))
    throw new ConflictException("service_checkout_selection_required");
  let now!: Date;
  const current = await readProfessionalCheckout(tx, session, () => { now = decisionClock(context, capability); return now; });
  if (current.policy.paymentMode !== "at_attendance") throw new ConflictException("service_online_payment_required");
  // Held merchant/session locks serialize with normal payment admission. Never
  // create a second local obligation beside an already admitted online intent.
  await assertNoActiveServiceCheckoutPayment(tx, buyer.merchantId, buyer.sessionId);
  const appointments: AppointmentWithPayments[] = [];
  for (const [index, selected] of current.selections.entries()) {
    const idempotencyKey = index === 0 ? input.commandId : createHash("sha256").update(JSON.stringify(["checkout-appointment-v1", buyer.merchantId,
      buyer.sessionId, input.commandId, index, selected.slotId])).digest("hex");
    const result = await admitServiceAppointment(tx, { merchantId: buyer.merchantId, ...selected,
      buyerGlobalUserId: buyer.globalUserId, customer: { name: session.customer?.fullName ?? "",
        ...(session.customer?.phone ? { phone: session.customer.phone } : {}), ...(session.customer?.email ? { email: session.customer.email } : {}) },
      actorId: buyer.globalUserId, origin: buyer.origin, idempotencyKey, confirmation: { kind: "at_attendance" } },
    { clock: () => { now = decisionClock(context, capability); return now; }, leaseOwner: { ownerId: buyer.sessionId, store: context.store ?? serviceSlotStore }, leaseSelections: current.selections });
    const payment = await ensureAtAttendancePayment(tx, result.appointment, now);
    appointments.push({ ...result.appointment, payments: [payment] });
  }
  const originalCapture = await tx.appointmentAudit.findUnique({ where: { merchantId_commandId: {
    merchantId: buyer.merchantId, commandId: input.commandId } } });
  await tx.appointmentAudit.update({ where: { merchantId_commandId: { merchantId: buyer.merchantId, commandId: input.commandId } },
    data: { action: "checkout_confirm", after: retainAppointmentLease(originalCapture?.after, { requestFingerprint: fingerprint,
      admissionFingerprint: appointments[0]!.requestFingerprint, checkoutSessionId: buyer.sessionId,
      cartFingerprint: input.cartFingerprint, operationalStatus: appointments[0]!.operationalStatus,
      policyVersion: appointments[0]!.policyVersion, priceInCents: appointments[0]!.priceInCents, currency: appointments[0]!.currency,
      appointmentIds: appointments.map(value => value.id) }) } });
  return { appointments, replayed: false };
}

export function confirmServiceAppointment(tx: Prisma.TransactionClient, buyer: ServiceCheckoutBuyer,
  input: ConfirmServiceAppointmentCommand, context: ConfirmationContext = {}) {
  return confirmWithin(tx, { kind: "buyer", buyer }, input, context);
}

export function confirmServiceAppointmentFromEmbed(tx: Prisma.TransactionClient, capability: ServiceCheckoutEmbedCapability,
  input: ConfirmServiceAppointmentCommand, context: ConfirmationContext = {}) {
  return confirmWithin(tx, { kind: "embed", capability }, input, context);
}

export class ConfirmServiceAppointmentUseCase {
  constructor(private readonly prisma: PrismaClient) {}
  execute(buyer: ServiceCheckoutBuyer, input: ConfirmServiceAppointmentCommand) {
    return this.prisma.$transaction(tx => confirmServiceAppointment(tx, buyer, input));
  }
  executeFromEmbed(capability: ServiceCheckoutEmbedCapability, input: ConfirmServiceAppointmentCommand) {
    return this.prisma.$transaction(tx => confirmServiceAppointmentFromEmbed(tx, capability, input));
  }
}
