import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, ServiceAppointment } from "@prisma/client";
import { assertServiceAdministration, type ServiceActor } from "./service-business-access.js";
import { lockCatalogMerchant } from "../persistence/catalog-stock-ledger.js";
import { lockServiceProfessional } from "./service-professional-lock.js";
import { admitWhatsAppEffectInTransaction } from "../whatsapp/whatsapp-automation-context.js";
import { readProfessionalServiceLink } from "../../modules/catalog/domain/services/professional-service-link.js";
import { getProfessionalAvailability } from "../../modules/catalog/application/get-professional-availability.js";
import { findAppointmentLeaseWithin } from "./appointment-lease-proof.js";
import { serviceSlotStore, type RedisServiceSlots } from "./redis-service-slots.js";
import { readProfessionalCheckoutSelections, professionalHoldRequests, type ProfessionalCheckoutSelection } from "./service-checkout-selection.js";
import { assertPaymentAmount, orderTotalCents, type PaymentAmountBreakdown } from "../../modules/payment/domain/payment-amount.js";
import { preserveVerifiedProfessionalAvailability } from "../../modules/catalog/application/professional-availability-continuation.js";
import { FIXED_SERVICE_TIME_ZONE } from "../../modules/catalog/domain/services/fixed-service-time-zone.js";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v && v.trim() === v && v.length <= 191;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export interface ManualServicePaymentCommand { appointmentId: string; expectedVersion: number; paymentIntentId: string; unitId: string; commandId: string }
interface Context { clock?: () => Date; store?: () => Pick<RedisServiceSlots, "assertCapturedActive"> }
type Continuation = { schemaVersion: 1; merchantId: string; appointmentId: string; appointmentVersion: number; paymentIntentId: string;
  sessionId: string; unitId: string; operatorId: string; paymentRecordId: string; admissionFingerprint: string; requestFingerprint: string;
  captureAuditId: string | null; selection: ProfessionalCheckoutSelection };
function selection(merchantId: string, value: unknown): ProfessionalCheckoutSelection {
  if (!object(value)) throw new ConflictException("service_manual_payment_receipt_required");
  const [parsed] = readProfessionalCheckoutSelections({ merchantId, cart: { currency: value.currency as string, items: [{
    sku: "manual-payment", name: "Manual appointment", product_id: value.productId as string, variantId: value.variantId as string,
    price: Number(value.priceInCents) / 100, quantity: 1, productType: "service", fulfillmentStrategy: "scheduled_service",
    fulfillmentSchedule: value as unknown as ProfessionalCheckoutSelection,
  }] } });
  if (!parsed || value.slotId !== parsed.slotId) throw new ConflictException("service_manual_payment_receipt_required");
  return parsed;
}
function receiptValue(value: unknown, merchantId: string): Continuation {
  const v = object(value) ? value.privatePaymentContinuation : undefined;
  if (!object(v) || v.schemaVersion !== 1 || v.merchantId !== merchantId
    || ![v.appointmentId, v.paymentIntentId, v.sessionId, v.unitId, v.operatorId, v.paymentRecordId].every(id)
    || !Number.isSafeInteger(v.appointmentVersion) || Number(v.appointmentVersion) < 1
    || typeof v.admissionFingerprint !== "string" || typeof v.requestFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(v.requestFingerprint) || v.captureAuditId !== null && !id(v.captureAuditId))
    throw new ConflictException("service_manual_payment_receipt_required");
  return { ...v, selection: selection(merchantId, v.selection) } as Continuation;
}
function matchesAppointment(a: ServiceAppointment, s: ProfessionalCheckoutSelection) {
  return a.productId === s.productId && a.variantId === s.variantId && a.professionalId === s.professionalId
    && a.policyVersion === s.policyVersion && a.startsAt.toISOString() === s.startsAt && a.endsAt.toISOString() === s.endsAt
    && a.timeZone === s.timeZone && a.durationMinutes === s.durationMinutes && a.priceInCents === s.priceInCents && a.currency === s.currency;
}
export async function assertManualServiceLeaseWithin(tx: Prisma.TransactionClient, appointment: ServiceAppointment,
  selected: ProfessionalCheckoutSelection, captureAuditId: string | null, context: Context = {}) {
  const binding = await findAppointmentLeaseWithin(tx, appointment), hold = object(appointment.policySnapshot) && appointment.policySnapshot.holdEnabled === true;
  if ((binding?.auditId ?? null) !== captureAuditId || hold && binding?.capture.kind !== "owned")
    throw new ConflictException("service_manual_payment_snapshot_changed");
  if (binding?.capture.kind === "owned") {
    const target = professionalHoldRequests([selected])[0], capture = binding.capture;
    if (capture.target.slotId !== target.slotId || capture.target.resourceId !== target.resourceId
      || capture.target.startsAt !== target.startsAt || capture.target.endsAt !== target.endsAt)
      throw new ConflictException("service_manual_payment_snapshot_changed");
    await (context.store ?? serviceSlotStore)().assertCapturedActive(appointment.merchantId, capture);
  }
  return binding;
}

/** SQL authority only. Caller owns merchant/sorted-professional locks. No
 * lookup by buyer, coordinates, names or today's cart can grant adoption. */
export async function readManualServicePaymentWithin(tx: Prisma.TransactionClient,
  input: { merchantId: string; paymentIntentId: string; unitId: string }) {
  const rows = await tx.appointmentAudit.findMany({ where: { merchantId: input.merchantId,
    after: { path: ["privatePaymentContinuation", "paymentIntentId"], equals: input.paymentIntentId } }, take: 101 });
  if (rows.length > 100) throw new ServiceUnavailableException("service_manual_payment_receipt_limit");
  if (!rows.length) {
    if (await tx.appointmentPayment.findFirst({ where: { merchantId: input.merchantId, paymentIntentId: input.paymentIntentId,
      appointment: { origin: "manual" } }, select: { id: true } })) throw new ConflictException("service_manual_payment_receipt_required");
    return;
  }
  const matches = rows.map(row => ({ row, proof: receiptValue(row.after, input.merchantId) })).filter(x => x.proof.unitId === input.unitId);
  if (matches.length !== 1) throw new ConflictException("service_manual_payment_unit_mismatch");
  const { row, proof } = matches[0];
  const appointment = await tx.serviceAppointment.findFirst({ where: { id: proof.appointmentId, merchantId: input.merchantId } });
  const payment = await tx.appointmentPayment.findFirst({ where: { id: proof.paymentRecordId, merchantId: input.merchantId,
    appointmentId: proof.appointmentId, paymentIntentId: input.paymentIntentId, mode: "online" } });
  if (!appointment || row.merchantId !== input.merchantId || row.appointmentId !== proof.appointmentId || row.action !== "manual_payment_prepare"
    || row.actorId !== proof.operatorId || row.version !== proof.appointmentVersion || proof.paymentIntentId !== input.paymentIntentId
    || appointment.origin !== "manual" || appointment.version !== proof.appointmentVersion || appointment.operationalStatus !== "pending"
    || appointment.orderId !== null || appointment.orderUnitId !== null || appointment.requestFingerprint !== proof.admissionFingerprint
    || !matchesAppointment(appointment, proof.selection) || !payment || payment.status !== "pending" || payment.receivedAt !== null
    || payment.requestFingerprint !== proof.requestFingerprint || payment.amountCents !== proof.selection.priceInCents || payment.currency !== proof.selection.currency)
    throw new ConflictException("service_manual_payment_snapshot_changed");
  return { appointment, payment, receipt: row, proof, selection: proof.selection, operatorId: proof.operatorId };
}

/** Future41 must call inside its actual journal-preparation transaction BEFORE
 * dispatch. This internal helper is not a public payment/identity body grant. */
export async function prepareManualServicePaymentWithin(tx: Prisma.TransactionClient, actor: ServiceActor,
  raw: ManualServicePaymentCommand, context: Context = {}) {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function") throw new BadRequestException("service_manual_payment_transaction_required");
  if (!object(raw) || Object.keys(raw).some(k => !["appointmentId", "expectedVersion", "paymentIntentId", "unitId", "commandId"].includes(k))
    || ![raw.appointmentId, raw.paymentIntentId, raw.unitId, raw.commandId].every(id) || !Number.isSafeInteger(raw.expectedVersion) || raw.expectedVersion < 1)
    throw new BadRequestException("service_manual_payment_command_invalid");
  const input = { ...raw }; actor = { ...actor };
  await admitWhatsAppEffectInTransaction(tx, actor.merchantId); await lockCatalogMerchant(tx, actor.merchantId); await assertServiceAdministration(tx, actor);
  const a = await tx.serviceAppointment.findFirst({ where: { id: input.appointmentId, merchantId: actor.merchantId, origin: "manual" } });
  if (!a) throw new NotFoundException("service_appointment_not_found");
  await lockServiceProfessional(tx, actor.merchantId, a.professionalId);
  await tx.$queryRaw`SELECT id FROM service_appointments WHERE id=${a.id} AND merchant_id=${actor.merchantId} FOR UPDATE`;
  const requestFingerprint = hash(["manual-service-payment-prepare-v1", actor.merchantId, actor.userId, a.id, input.expectedVersion, input.paymentIntentId, input.unitId]);
  const prior = await tx.appointmentAudit.findUnique({ where: { merchantId_commandId: { merchantId: actor.merchantId, commandId: input.commandId } } })
    ?? await tx.appointmentAudit.findFirst({ where: { merchantId: actor.merchantId,
      after: { path: ["privatePaymentContinuation", "requestFingerprint"], equals: requestFingerprint } } });
  if (prior) {
    const proof = receiptValue(prior.after, actor.merchantId);
    if (prior.action !== "manual_payment_prepare" || prior.appointmentId !== a.id || proof.requestFingerprint !== requestFingerprint)
      throw new ConflictException("service_appointment_idempotency_conflict");
    const payment = await tx.appointmentPayment.findFirstOrThrow({ where: { id: proof.paymentRecordId, merchantId: actor.merchantId,
      appointmentId: a.id, paymentIntentId: input.paymentIntentId } });
    return { payment, receipt: prior, replayed: true };
  }
  if (a.version !== input.expectedVersion) throw new ConflictException("service_appointment_version_conflict");
  if (a.operationalStatus !== "pending" || a.orderId !== null || !object(a.policySnapshot) || a.policySnapshot.paymentMode !== "online")
    throw new ConflictException("service_manual_payment_snapshot_changed");
  const intent = await tx.paymentIntent.findFirst({ where: { id: input.paymentIntentId, merchantId: actor.merchantId } });
  if (!intent) throw new NotFoundException("service_manual_payment_intent_not_found");
  const creation = object(intent.creation) ? intent.creation : undefined;
  if (intent.status !== "pending" || intent.providerPaymentId !== null || creation?.state !== "ready" || creation.firstAttemptAt !== undefined || creation.leaseToken !== undefined)
    throw new ConflictException("service_manual_payment_not_unsubmitted");
  const checkout = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: actor.merchantId, sessionId: intent.sessionId } } });
  if (!checkout || !object(checkout.cart) || !Array.isArray(checkout.cart.items) || checkout.cart.items.length !== 1)
    throw new ConflictException("service_manual_payment_snapshot_changed");
  const [selected] = readProfessionalCheckoutSelections({ merchantId: actor.merchantId, cart: checkout.cart as any });
  const facts = await readProfessionalServiceLink(tx, { merchantId: actor.merchantId, productId: a.productId, variantId: a.variantId, professionalId: a.professionalId });
  const policy = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId: actor.merchantId } });
  if (!selected || !matchesAppointment(a, selected) || facts.professionalVersion !== selected.professionalVersion || facts.durationMinutes !== selected.durationMinutes
    || selected.timeZone !== FIXED_SERVICE_TIME_ZONE && facts.timeZone !== selected.timeZone
    || facts.priceInCents !== selected.priceInCents || facts.currency !== selected.currency
    || !policy?.configuredAt || !policy.admissionsEnabled || policy.paymentMode !== "online" || policy.version !== selected.policyVersion)
    throw new ConflictException("service_manual_payment_snapshot_changed");
  const breakdown = intent.amountBreakdown as PaymentAmountBreakdown | null;
  if (breakdown) assertPaymentAmount(breakdown, intent.amountCents, intent.currency);
  if (intent.currency !== selected.currency || orderTotalCents(breakdown ?? undefined, intent.amountCents) !== selected.priceInCents)
    throw new ConflictException("service_manual_payment_amount_mismatch");
  const preflightAt = context.clock ? context.clock() : new Date();
  if (!(preflightAt instanceof Date) || !Number.isFinite(preflightAt.getTime())) throw new BadRequestException("service_manual_payment_invalid_clock");
  if (selected.timeZone !== FIXED_SERVICE_TIME_ZONE) {
    const originalBinding = await findAppointmentLeaseWithin(tx, a);
    await assertManualServiceLeaseWithin(tx, a, selected, originalBinding?.auditId ?? null, context);
  }
  const available = await getProfessionalAvailability(tx, { merchantId: actor.merchantId, productId: a.productId, variantId: a.variantId,
    professionalId: a.professionalId, fromDate: selected.date, toDate: selected.date, expectedVersion: selected.professionalVersion, now: preflightAt },
  { excludeAppointment: { appointmentId: a.id, expectedVersion: a.version },
    continuation: preserveVerifiedProfessionalAvailability(actor.merchantId, selected) });
  if (available.status !== "ready" || !available.slots.some(slot => slot.startsAt === selected.startsAt && slot.endsAt === selected.endsAt))
    throw new ConflictException("service_slot_unavailable");
  const binding = await findAppointmentLeaseWithin(tx, a);
  await assertManualServiceLeaseWithin(tx, a, selected, binding?.auditId ?? null, context);
  const now = context.clock ? context.clock() : new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || a.startsAt <= now) throw new ConflictException("service_slot_unavailable");
  const payment = await tx.appointmentPayment.create({ data: { id: randomUUID(), merchantId: actor.merchantId, appointmentId: a.id,
    paymentIntentId: intent.id, mode: "online", status: "pending", amountCents: a.priceInCents, currency: a.currency,
    idempotencyKey: "manual-payment:" + requestFingerprint, requestFingerprint } });
  const proof: Continuation = { schemaVersion: 1, merchantId: actor.merchantId, appointmentId: a.id, appointmentVersion: a.version,
    paymentIntentId: intent.id, sessionId: intent.sessionId, unitId: input.unitId, operatorId: actor.userId,
    paymentRecordId: payment.id, admissionFingerprint: a.requestFingerprint, requestFingerprint, captureAuditId: binding?.auditId ?? null, selection: selected };
  const receipt = await tx.appointmentAudit.create({ data: { merchantId: actor.merchantId, appointmentId: a.id, commandId: input.commandId,
    version: a.version, action: "manual_payment_prepare", actorId: actor.userId, origin: "operator", occurredAt: now,
    after: { privatePaymentContinuation: proof } as unknown as Prisma.InputJsonValue } });
  return { payment, receipt, replayed: false };
}
