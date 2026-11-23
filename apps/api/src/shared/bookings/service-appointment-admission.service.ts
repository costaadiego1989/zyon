import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma, ServiceAppointment } from "@prisma/client";
import { resolveServiceBusinessPolicy } from "../../modules/merchant/domain/service-business-policy.js";
import { getProfessionalAvailability } from "../../modules/catalog/application/get-professional-availability.js";
import { fulfillmentPaymentEligible } from "../persistence/order-fulfillment.js";
import { lockServiceProfessional } from "./service-professional-lock.js";
import { assertProfessionalLease, type ProfessionalLeaseOwner } from "./professional-service-lease.js";
import { professionalSlotId, professionalHoldRequests, type ProfessionalCheckoutSelection } from "./service-checkout-selection.js";
import { captureAppointmentLease, noAppointmentLease, assertLeaseCaptureUnusedWithin, type OwnedAppointmentLease } from "./appointment-lease-proof.js";
import type { ActiveSlotLeaseProof, RedisServiceSlots } from "./redis-service-slots.js";
import { readManualServicePaymentWithin, assertManualServiceLeaseWithin } from "./manual-service-payment-continuation.js";
import { hasUnclassifiedServiceReservations } from "./service-legacy-readiness.js";
import { admitWhatsAppEffectInTransaction } from "../whatsapp/whatsapp-automation-context.js";
import { preserveVerifiedProfessionalAvailability, type ProfessionalAvailabilityContinuation } from "../../modules/catalog/application/professional-availability-continuation.js";
import { FIXED_SERVICE_TIME_ZONE } from "../../modules/catalog/domain/services/fixed-service-time-zone.js";

export interface ServiceAppointmentAdmissionInput {
  merchantId: string;
  professionalId: string;
  productId: string;
  variantId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  professionalVersion: number;
  policyVersion: number;
  priceInCents: number;
  currency: string;
  customer: { name: string; phone?: string; email?: string };
  buyerGlobalUserId?: string;
  origin: "whatsapp" | "storefront" | "manual";
  actorId: string;
  idempotencyKey: string;
  confirmation: { kind: "pending" } | { kind: "at_attendance" }
    | { kind: "approved_order_unit"; orderId: string; unitId: string };
}

interface AdmissionContext {
  /** Internal clock for post-lock preflight and final decision after IO. Never a buyer timestamp. */
  clock?: () => Date;
  leaseOwner?: ProfessionalLeaseOwner;
  leaseSelections?: ProfessionalCheckoutSelection[];
  /** Private original acquire result supplied by a trusted pending writer. */
  acquiredLeaseProof?: ActiveSlotLeaseProof;
  /** Server-only durable financial link. Never read from an admission DTO. */
  pendingPaymentRecordId?: string;
  capturedLeaseStore?: () => Pick<RedisServiceSlots, "assertCapturedActive">;
  /** Internal unit-test seam. HTTP/channel callers use the canonical default. */
  readAvailability?: typeof getProfessionalAvailability;
}

async function assertContinuedLease(input: ServiceAppointmentAdmissionInput, capture: OwnedAppointmentLease, context: AdmissionContext) {
  const store = context.capturedLeaseStore?.() ?? context.leaseOwner?.store();
  if (!store || !("assertCapturedActive" in store) || typeof store.assertCapturedActive !== "function")
    throw new ConflictException("service_hold_original_proof_required");
  await store.assertCapturedActive(input.merchantId, capture);
}

function normalizedCustomer(value: ServiceAppointmentAdmissionInput["customer"]): ServiceAppointmentAdmissionInput["customer"] {
  const invalid = () => new BadRequestException("service_appointment_invalid_customer");
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.name !== "string"
    || !value.name.trim() || value.name.length > 200 || /[\u0000-\u001f\u007f]/.test(value.name)) throw invalid();
  if (value.phone !== undefined && (typeof value.phone !== "string" || value.phone.length > 32)) throw invalid();
  if (value.email !== undefined && (typeof value.email !== "string" || value.email.length > 254)) throw invalid();
  const phone = value.phone?.trim(), email = value.email?.trim().toLowerCase();
  if (phone && (!/^[+\d(). -]+$/.test(phone) || !/^\d{10,15}$/.test(phone.replace(/\D/g, "")))) throw invalid();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid();
  if (!phone && !email) throw invalid();
  return { name: value.name.trim(), ...(phone ? { phone } : {}), ...(email ? { email } : {}) };
}

function assertInput(input: ServiceAppointmentAdmissionInput): void {
  const ids = [input.merchantId, input.professionalId, input.productId, input.variantId, input.actorId, input.idempotencyKey];
  const startsAt = Date.parse(input.startsAt), endsAt = Date.parse(input.endsAt);
  if (ids.some(id => typeof id !== "string" || !id.trim() || id.length > 191)
    || !["whatsapp", "storefront", "manual"].includes(input.origin)
    || !["pending", "at_attendance", "approved_order_unit"].includes(input.confirmation?.kind)
    || typeof input.date !== "string" || typeof input.startsAt !== "string" || typeof input.endsAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
    || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt
    || !Number.isSafeInteger(input.professionalVersion) || input.professionalVersion < 1
    || !Number.isSafeInteger(input.policyVersion) || input.policyVersion < 1
    || !Number.isSafeInteger(input.priceInCents) || input.priceInCents < 0
    || typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)
    || (input.buyerGlobalUserId !== undefined && (typeof input.buyerGlobalUserId !== "string" || !input.buyerGlobalUserId.trim() || input.buyerGlobalUserId.length > 191))
    || !input.customer || typeof input.customer.name !== "string" || !input.customer.name.trim()
    || !(input.customer.phone || input.customer.email)) throw new BadRequestException("service_appointment_invalid_input");
  if (input.confirmation.kind === "approved_order_unit"
    && [input.confirmation.orderId, input.confirmation.unitId].some(id => typeof id !== "string" || !id || id.length > 191))
    throw new BadRequestException("service_appointment_invalid_payment_reference");
}

function requestFingerprint(input: ServiceAppointmentAdmissionInput): string {
  // Construct fields deliberately: JSON object insertion order from a client is
  // not an idempotency identity. Never include arbitrary customer metadata.
  return createHash("sha256").update(JSON.stringify([
    "service-appointment-admission-v1", input.merchantId, input.professionalId, input.productId, input.variantId,
    input.date, new Date(input.startsAt).toISOString(), new Date(input.endsAt).toISOString(), input.professionalVersion,
    input.policyVersion, input.priceInCents, input.currency, input.customer.name,
    input.customer.phone ?? null, input.customer.email ?? null, input.buyerGlobalUserId ?? null,
    input.origin, input.actorId, input.confirmation.kind,
    input.confirmation.kind === "approved_order_unit" ? input.confirmation.orderId : null,
    input.confirmation.kind === "approved_order_unit" ? input.confirmation.unitId : null,
  ])).digest("hex");
}

async function assertApprovedOrderUnit(tx: Prisma.TransactionClient, input: ServiceAppointmentAdmissionInput,
  manual?: Awaited<ReturnType<typeof readManualServicePaymentWithin>>) {
  if (input.confirmation.kind !== "approved_order_unit") return;
  const order = await tx.completedOrder.findFirst({ where: { id: input.confirmation.orderId, merchantId: input.merchantId } });
  if (!order || order.currency !== input.currency || ["cancelled", "refunded", "returned", "failed"].includes(order.status))
    throw new ConflictException("service_payment_evidence_invalid");
  const checkout = await tx.checkoutSession.findUnique({ where: {
    merchantId_sessionId: { merchantId: input.merchantId, sessionId: order.sessionId },
  }, select: { globalUserId: true } });
  if (!checkout || (!manual && (!input.buyerGlobalUserId || checkout.globalUserId !== input.buyerGlobalUserId))
    || manual && manual.proof.sessionId !== order.sessionId)
    throw new ConflictException("service_payment_buyer_mismatch");
  const payment = await tx.paymentIntent.findFirst({ where: {
    merchantId: input.merchantId, sessionId: order.sessionId, providerPaymentId: order.externalOrderId, status: "approved",
  } });
  if (!fulfillmentPaymentEligible(order, payment)) throw new ConflictException("service_payment_evidence_invalid");
  if (manual && payment?.id !== manual.proof.paymentIntentId) throw new ConflictException("service_payment_evidence_invalid");
  const lines = Array.isArray(order.lineItemsJson) ? order.lineItemsJson : [];
  const unitId = input.confirmation.unitId;
  const line = lines.find(value => value && typeof value === "object" && !Array.isArray(value) && value.lineId === unitId);
  if (!line || typeof line !== "object" || Array.isArray(line)) throw new ConflictException("service_payment_unit_mismatch");
  const schedule = line.schedule;
  if (line.snapshotVersion !== 2 || line.productType !== "service" || line.quantity !== 1
    || line.fulfillmentStrategy !== "scheduled_service" || line.variantId !== input.variantId || line.unitPriceCents !== input.priceInCents
    || !schedule || typeof schedule !== "object" || Array.isArray(schedule)
    || schedule.professionalId !== input.professionalId || schedule.professionalVersion !== input.professionalVersion
    || schedule.policyVersion !== input.policyVersion || schedule.date !== input.date
    || typeof schedule.timeZone !== "string" || !Number.isSafeInteger(schedule.durationMinutes)
    || Number(schedule.durationMinutes) < 5 || Number(schedule.durationMinutes) > 480
    || schedule.startsAt !== new Date(input.startsAt).toISOString()
    || schedule.endsAt !== new Date(input.endsAt).toISOString()) throw new ConflictException("service_payment_unit_mismatch");
  return { payment, slot: { timeZone: schedule.timeZone, durationMinutes: Number(schedule.durationMinutes) } };
}

/** The caller owns this transaction and commits/rolls back admission, its audit
 * and outbox together. All capacity writers use merchant -> professional order.
 * No root/autocommit Prisma client or untrusted HTTP payload belongs here. */
export async function admitServiceAppointment(
  tx: Prisma.TransactionClient,
  input: ServiceAppointmentAdmissionInput,
  context: AdmissionContext = {},
): Promise<{ appointment: ServiceAppointment; replayed: boolean }> {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function")
    throw new BadRequestException("service_appointment_transaction_required");
  input = { ...input, customer: normalizedCustomer(input.customer) };
  assertInput(input);
  await admitWhatsAppEffectInTransaction(tx, input.merchantId);
  const fingerprint = requestFingerprint(input);
  const merchantLock = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`;
  if (merchantLock.length !== 1) throw new NotFoundException("merchant_not_found");
  await lockServiceProfessional(tx, input.merchantId, input.professionalId);
  let manual: Awaited<ReturnType<typeof readManualServicePaymentWithin>>;
  if (context.pendingPaymentRecordId) {
    if (input.confirmation.kind !== "approved_order_unit") throw new ConflictException("service_manual_payment_receipt_required");
    const financial = await tx.appointmentPayment.findFirst({ where: { id: context.pendingPaymentRecordId, merchantId: input.merchantId } });
    if (!financial?.paymentIntentId) throw new ConflictException("service_manual_payment_receipt_required");
    manual = await readManualServicePaymentWithin(tx, { merchantId: input.merchantId, paymentIntentId: financial.paymentIntentId, unitId: input.confirmation.unitId });
    const a = manual?.appointment, s = manual?.selection;
    if (!manual || financial.id !== manual.payment.id || !a || !s || input.origin !== "manual" || input.actorId !== manual.operatorId
      || input.professionalId !== s.professionalId || input.productId !== s.productId || input.variantId !== s.variantId
      || input.professionalVersion !== s.professionalVersion || input.policyVersion !== s.policyVersion || input.date !== s.date
      || input.startsAt !== s.startsAt || input.endsAt !== s.endsAt || input.priceInCents !== s.priceInCents || input.currency !== s.currency
      || (input.buyerGlobalUserId ?? null) !== a.buyerGlobalUserId || !a.customerSnapshot || typeof a.customerSnapshot !== "object" || Array.isArray(a.customerSnapshot)
      || input.customer.name !== a.customerSnapshot.name || (input.customer.email ?? null) !== (a.customerSnapshot.email ?? null)
      || (input.customer.phone ?? null) !== (a.customerSnapshot.phone ?? null))
      throw new ConflictException("service_manual_payment_snapshot_changed");
    await tx.$queryRaw`SELECT id FROM service_appointments WHERE id=${a.id} AND merchant_id=${input.merchantId} FOR UPDATE`;
  }
  const previous = await tx.serviceAppointment.findUnique({ where: {
    merchantId_idempotencyKey: { merchantId: input.merchantId, idempotencyKey: input.idempotencyKey },
  } });
  if (previous) {
    if (previous.requestFingerprint !== fingerprint) throw new ConflictException("service_appointment_idempotency_conflict");
    return { appointment: previous, replayed: true };
  }
  // A past timestamp is not proof that a legacy reservation was fulfilled or
  // classified. Keep historical reconciliation, but do not guess its resource.
  if (await hasUnclassifiedServiceReservations(tx, input.merchantId))
    throw new ConflictException("service_legacy_classification_required");
  const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId }, select: {
    businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true,
  } });
  if (!merchant) throw new NotFoundException("merchant_not_found");
  const policyRow = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId: input.merchantId } });
  const business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData: false, policy: policyRow });
  if (!business.capabilities.serviceBooking || !business.policy) throw new ConflictException("service_booking_" + business.bookingBlockReason);
  if (business.policyVersion !== input.policyVersion) throw new ConflictException("service_policy_changed");
  if (input.confirmation.kind === "at_attendance" && business.policy.paymentMode !== "at_attendance"
    || input.confirmation.kind === "approved_order_unit" && business.policy.paymentMode !== "online")
    throw new ConflictException("service_payment_policy_conflict");
  const variant = await tx.productVariant.findFirst({ where: { id: input.variantId, productId: input.productId,
    isActive: true, product: { merchantId: input.merchantId, type: "service", isActive: true, deletedAt: null } },
    include: { product: true, price: true } });
  if (!variant?.price || variant.price.basePriceInCents !== input.priceInCents || variant.price.currency !== input.currency)
    throw new ConflictException("service_offer_changed");
  let now = context.clock ? context.clock() : new Date();
  if (!Number.isFinite(now.getTime())) throw new BadRequestException("service_appointment_invalid_clock");
  // Frozen paid units and private same-ID manual continuations may carry a
  // historical civil date. Verify the existing evidence BEFORE using it as a
  // presentation context; raw admission fields never choose a timezone.
  const approvedReference = await assertApprovedOrderUnit(tx, input, manual);
  let continuation: ProfessionalAvailabilityContinuation | undefined;
  let continuedLease: OwnedAppointmentLease | undefined, verifiedHeldProof: ActiveSlotLeaseProof | undefined;
  if (manual) {
    if (manual.selection.timeZone !== FIXED_SERVICE_TIME_ZONE) {
      await assertManualServiceLeaseWithin(tx, manual.appointment, manual.selection, manual.proof.captureAuditId, { store: context.capturedLeaseStore });
      continuation = preserveVerifiedProfessionalAvailability(input.merchantId, manual.selection);
    }
  } else if (approvedReference) {
    continuation = preserveVerifiedProfessionalAvailability(input.merchantId, { ...input, ...approvedReference.slot });
  } else if (context.leaseOwner?.ownerId && (context.acquiredLeaseProof || business.policy.holdEnabled && input.confirmation.kind !== "pending")) {
    const held = context.leaseSelections?.find(s => s.productId === input.productId && s.variantId === input.variantId
      && s.professionalId === input.professionalId && s.professionalVersion === input.professionalVersion && s.policyVersion === input.policyVersion
      && s.date === input.date && s.startsAt === input.startsAt && s.endsAt === input.endsAt
      && s.priceInCents === input.priceInCents && s.currency === input.currency);
    if (!held && context.acquiredLeaseProof) throw new ConflictException("service_hold_selection_mismatch");
    if (held && held.timeZone !== FIXED_SERVICE_TIME_ZONE) {
      verifiedHeldProof = context.acquiredLeaseProof ?? await assertProfessionalLease(input.merchantId, context.leaseSelections!, business.policy, context.leaseOwner);
      const capture = captureAppointmentLease(input.merchantId, context.leaseOwner.ownerId, verifiedHeldProof, professionalHoldRequests([held])[0]);
      if (Date.parse(capture.expiresAt) <= now.getTime()) throw new ConflictException("checkout_service_hold_expired");
      await assertContinuedLease(input, capture, context); continuedLease = capture;
      continuation = preserveVerifiedProfessionalAvailability(input.merchantId, held);
    }
  }
  let availability: Awaited<ReturnType<typeof getProfessionalAvailability>>;
  try {
    availability = await (context.readAvailability ?? getProfessionalAvailability)(tx, {
      merchantId: input.merchantId, productId: input.productId, variantId: input.variantId, professionalId: input.professionalId,
      fromDate: input.date, toDate: input.date, now, expectedVersion: input.professionalVersion,
    }, { continuation });
  } catch (error) {
    // A frozen approved unit failing the private historical-context check is
    // still a financial unit mismatch. Keep manual and every other error exact.
    if (approvedReference && !manual && error instanceof ConflictException && error.message === "service_timezone_continuation_conflict")
      throw new ConflictException("service_payment_unit_mismatch");
    throw error;
  }
  if (availability.status === "stale" || availability.professionalVersion !== input.professionalVersion)
    throw new ConflictException("service_selection_stale");
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
  const slot = availability.slots.find(candidate => candidate.date === input.date
    && Date.parse(candidate.startsAt) === startsAt.getTime() && Date.parse(candidate.endsAt) === endsAt.getTime());
  if (availability.status !== "ready" || !slot || startsAt <= now) throw new ConflictException("service_slot_unavailable");
  if (availability.policyVersion !== input.policyVersion) throw new ConflictException("service_policy_changed");
  const selected = { productId: input.productId, variantId: input.variantId, professionalId: input.professionalId,
    professionalVersion: input.professionalVersion, policyVersion: input.policyVersion, date: input.date,
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), timeZone: slot.timeZone,
    durationMinutes: slot.durationMinutes, priceInCents: variant.price.basePriceInCents, currency: variant.price.currency };
  const own = { ...selected, slotId: professionalSlotId(input.merchantId, selected) };
  const leaseTarget = professionalHoldRequests([own])[0];
  let privateLease = noAppointmentLease(leaseTarget, business.policy.holdEnabled ? "pending_without_lease" : "hold_off") as
    ReturnType<typeof noAppointmentLease> | ReturnType<typeof captureAppointmentLease>;
  if (manual) {
    await assertManualServiceLeaseWithin(tx, manual.appointment, own, manual.proof.captureAuditId, { store: context.capturedLeaseStore });
  } else if (business.policy.holdEnabled && (input.confirmation.kind !== "pending" || context.acquiredLeaseProof)) {
    const leaseSelections = context.leaseSelections ?? [own];
    if (!leaseSelections.some(candidate => candidate.slotId === own.slotId && professionalSlotId(input.merchantId, candidate) === own.slotId))
      throw new ConflictException("service_hold_selection_mismatch");
    if (!context.leaseOwner?.ownerId) throw new ConflictException("service_hold_required");
    const proof = verifiedHeldProof ?? (input.confirmation.kind === "pending" ? context.acquiredLeaseProof
      : await assertProfessionalLease(input.merchantId, leaseSelections, business.policy, context.leaseOwner));
    privateLease = captureAppointmentLease(input.merchantId, context.leaseOwner.ownerId, proof, leaseTarget);
    await assertLeaseCaptureUnusedWithin(tx, input.merchantId, privateLease);
  }
  if (approvedReference && (approvedReference.slot.timeZone !== slot.timeZone || approvedReference.slot.durationMinutes !== slot.durationMinutes))
    throw new ConflictException("service_payment_unit_mismatch");
  const approved = approvedReference?.payment;
  now = context.clock ? context.clock() : new Date();
  if (!Number.isFinite(now.getTime())) throw new BadRequestException("service_appointment_invalid_clock");
  if (startsAt <= now) throw new ConflictException("service_slot_unavailable");
  if (continuedLease) await assertContinuedLease(input, continuedLease, context);
  if (manual && approved && input.confirmation.kind === "approved_order_unit") {
    const a = manual.appointment, version = a.version + 1;
    const changed = await tx.serviceAppointment.updateMany({ where: { id: a.id, merchantId: input.merchantId,
      version: a.version, operationalStatus: "pending", orderId: null, orderUnitId: null, requestFingerprint: manual.proof.admissionFingerprint },
      data: { operationalStatus: "scheduled", confirmedAt: now, version, orderId: input.confirmation.orderId, orderUnitId: input.confirmation.unitId } });
    if (changed.count !== 1) throw new ConflictException("service_appointment_version_conflict");
    const financial = await tx.appointmentPayment.updateMany({ where: { id: manual.payment.id, merchantId: input.merchantId,
      appointmentId: a.id, paymentIntentId: approved.id, version: manual.payment.version, status: "pending", receivedAt: null },
      data: { status: "approved", version: { increment: 1 }, providerPaymentId: approved.providerPaymentId,
        providerEvidence: { paymentIntentId: approved.id, approvedAmountCents: approved.approvedAmountCents, currency: approved.currency }, receivedAt: now } });
    if (financial.count !== 1) throw new ConflictException("service_manual_payment_snapshot_changed");
    await tx.appointmentAudit.create({ data: { merchantId: input.merchantId, appointmentId: a.id, commandId: input.idempotencyKey,
      version, action: "manual_payment_approved", actorId: manual.operatorId, origin: "payment", occurredAt: now,
      before: { operationalStatus: "pending", version: a.version }, after: { operationalStatus: "scheduled", version,
        paymentRecordId: manual.payment.id, paymentIntentId: approved.id, continuationAuditId: manual.receipt.id } } });
    const eventType = "service.appointment.scheduled";
    await tx.outboxMessage.create({ data: { eventId: createHash("sha256").update(JSON.stringify([input.merchantId, a.id, version, eventType])).digest("hex"),
      eventType, schemaVersion: 1, merchantId: input.merchantId, occurredAt: now, correlationId: a.id, causationId: input.idempotencyKey,
      producer: "service-booking", payload: { appointmentId: a.id, version, operationalStatus: "scheduled" } } });
    return { appointment: await tx.serviceAppointment.findUniqueOrThrow({ where: { id: a.id } }), replayed: false };
  }
  const status = input.confirmation.kind === "pending" ? "pending" : "scheduled";
  const appointment = await tx.serviceAppointment.create({ data: {
    merchantId: input.merchantId, professionalId: input.professionalId, productId: input.productId, variantId: input.variantId,
    buyerGlobalUserId: input.buyerGlobalUserId ?? null,
    customerSnapshot: { name: input.customer.name, ...(input.customer.phone ? { phone: input.customer.phone } : {}),
      ...(input.customer.email ? { email: input.customer.email } : {}) },
    startsAt, endsAt, timeZone: slot.timeZone, durationMinutes: slot.durationMinutes,
    priceInCents: variant.price.basePriceInCents, currency: variant.price.currency,
    policyVersion: input.policyVersion, policySnapshot: { ...business.policy },
    origin: input.origin, operationalStatus: status, idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
    ...(input.confirmation.kind === "approved_order_unit" ? { orderId: input.confirmation.orderId, orderUnitId: input.confirmation.unitId } : {}),
    confirmedAt: status === "scheduled" ? now : null,
  } });
  try {
    await tx.appointmentAudit.create({ data: { merchantId: input.merchantId, appointmentId: appointment.id,
      commandId: input.idempotencyKey, version: 1, action: "admit", actorId: input.actorId, origin: input.origin, occurredAt: now,
      after: { operationalStatus: status, policyVersion: input.policyVersion, priceInCents: appointment.priceInCents, currency: appointment.currency,
        ...(privateLease.kind === "owned" ? { privateLease } : {}) } } });
  } catch (error) {
    if (privateLease.kind === "owned" && error && typeof error === "object" && "code" in error && error.code === "P2002")
      throw new ConflictException("service_hold_generation_consumed");
    throw error;
  }
  const eventType = "service.appointment." + status;
  const eventId = createHash("sha256").update(JSON.stringify([input.merchantId, appointment.id, 1, eventType])).digest("hex");
  await tx.outboxMessage.create({ data: { eventId, eventType, schemaVersion: 1, merchantId: input.merchantId,
    occurredAt: now, correlationId: appointment.id, causationId: input.idempotencyKey, producer: "service-booking",
    payload: { appointmentId: appointment.id, version: 1, operationalStatus: status } } });
  return { appointment, replayed: false };
}
