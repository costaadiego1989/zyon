// Composes existing canonical writers inside one caller-owned transaction.
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { admitWhatsAppEffectInTransaction } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { readProfessionalServiceLink } from "../../catalog/domain/services/professional-service-link.js";
import { professionalLocalDate } from "../../catalog/domain/services/professional-availability.js";
import { parseServiceInstant } from "../../catalog/domain/services/professional-availability-input.js";
import { assertExpectedVersion } from "../../catalog/domain/services/service-professional-input.js";
import { saveAvailabilityException } from "../../catalog/application/save-availability-exception.use-case.js";
import { getProfessionalAvailability } from "../../catalog/application/get-professional-availability.js";
import { resolveServiceBusinessPolicy } from "../../merchant/domain/service-business-policy.js";
import { admitServiceAppointment } from "../../../shared/bookings/service-appointment-admission.service.js";
import { ensureAtAttendancePayment } from "../../../shared/bookings/service-at-attendance-payment.js";
import { acquireProfessionalLease, type ProfessionalLeaseStore } from "../../../shared/bookings/professional-service-lease.js";
import { professionalSlotId, type ProfessionalCheckoutSelection } from "../../../shared/bookings/service-checkout-selection.js";
import { serviceSlotStore } from "../../../shared/bookings/redis-service-slots.js";
import type { DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";

type Contact = { name: string; phone?: string; email?: string };
export type ManualCustomer = { kind: "known"; customerId: string } | ({ kind: "contact" } & Contact);
export interface ManualServiceAppointmentCommand {
  commandId: string;
  professionalId: string;
  productId: string;
  variantId: string;
  expectedProfessionalVersion: number;
  expectedPolicyVersion: number;
  startsAt: string;
  customer: ManualCustomer;
  explicitOneOff?: { reason?: string };
}
interface ManualContext { clock?: () => Date; store?: () => ProfessionalLeaseStore }
type Appointment = Prisma.ServiceAppointmentGetPayload<{ include: { payments: true } }>;
export interface ManualAppointmentResult {
  appointment: Appointment;
  replayed: boolean;
  professionalVersion: number;
  availabilityExceptionId: string | null;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown) => typeof value === "string" && !!value && value.trim() === value && value.length <= 191;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function command(value: ManualServiceAppointmentCommand) {
  if (!record(value) || Object.keys(value).some(key => !["commandId", "professionalId", "productId", "variantId",
    "expectedProfessionalVersion", "expectedPolicyVersion", "startsAt", "customer", "explicitOneOff"].includes(key))
    || ![value.commandId, value.professionalId, value.productId, value.variantId].every(identifier))
    throw new BadRequestException("service_manual_command_invalid");
  assertExpectedVersion(value.expectedProfessionalVersion);
  assertExpectedVersion(value.expectedPolicyVersion);
  const startsAt = parseServiceInstant(value.startsAt);
  const customer = value.customer;
  if (!record(customer) || customer.kind !== "known" && customer.kind !== "contact")
    throw new BadRequestException("service_manual_customer_invalid");
  if (customer.kind === "known") {
    if (!identifier(customer.customerId) || Object.keys(customer).some(key => !["kind", "customerId"].includes(key)))
      throw new BadRequestException("service_manual_customer_invalid");
  } else if (Object.keys(customer).some(key => !["kind", "name", "phone", "email"].includes(key))
    || typeof customer.name !== "string" || customer.phone !== undefined && typeof customer.phone !== "string"
    || customer.email !== undefined && typeof customer.email !== "string") {
    throw new BadRequestException("service_manual_customer_invalid");
  }
  if (value.explicitOneOff !== undefined && (!record(value.explicitOneOff)
    || Object.keys(value.explicitOneOff).some(key => key !== "reason")
    || value.explicitOneOff.reason !== undefined && (typeof value.explicitOneOff.reason !== "string" || value.explicitOneOff.reason.length > 1200)))
    throw new BadRequestException("service_manual_one_off_invalid");
  return { ...value, startsAt: startsAt.toISOString(), customer: { ...value.customer },
    ...(value.explicitOneOff !== undefined ? { explicitOneOff: { ...value.explicitOneOff } } : {}) };
}

function clock(context: ManualContext) {
  const now = context.clock ? context.clock() : new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BadRequestException("service_manual_clock_invalid");
  return now;
}

async function resolveCustomer(tx: Prisma.TransactionClient, actor: ServiceActor, customer: ManualCustomer) {
  if (customer.kind === "contact") return { customer: { name: customer.name,
    ...(customer.phone !== undefined ? { phone: customer.phone } : {}), ...(customer.email !== undefined ? { email: customer.email } : {}) } };
  // Same tenant+UID identity as PrismaOperationsReadRepository.getCustomer:226–234;
  // use the provided transaction, never a repository backed by the root client.
  const row = await tx.checkoutSession.findFirst({ where: { merchantId: actor.merchantId, globalUserId: customer.customerId },
    orderBy: [{ updatedAt: "desc" }, { sessionId: "desc" }], select: { globalUserId: true, customer: true } });
  if (!row) throw new NotFoundException("service_manual_customer_not_found");
  const profile = record(row.customer) ? row.customer : {};
  return { buyerGlobalUserId: row.globalUserId, customer: {
    name: typeof profile.fullName === "string" ? profile.fullName : "",
    ...(typeof profile.phone === "string" ? { phone: profile.phone } : {}),
    ...(typeof profile.email === "string" ? { email: profile.email } : {}),
  } };
}

/** Actor is resolved from the existing authenticated human tenant principal;
 * it is never deserialized from the command/body. All SQL belongs to the caller's transaction; a rejection must roll it back.
 * Production entrypoint below owns the default-budget transaction. */
export async function createManualServiceAppointmentWithin(tx: Prisma.TransactionClient, actor: ServiceActor,
  raw: ManualServiceAppointmentCommand, context: ManualContext = {}): Promise<ManualAppointmentResult> {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function")
    throw new BadRequestException("service_manual_transaction_required");
  const input = command(raw);
  await admitWhatsAppEffectInTransaction(tx, actor.merchantId);
  await lockCatalogMerchant(tx, actor.merchantId);
  await assertServiceAdministration(tx, actor);
  await lockServiceProfessional(tx, actor.merchantId, input.professionalId);
  const customerKey = input.customer.kind === "known" ? ["known", input.customer.customerId]
    : ["contact", input.customer.name, input.customer.phone ?? null, input.customer.email ?? null];
  const requestFingerprint = digest(["manual-appointment-v1", actor.merchantId, actor.userId, input.professionalId,
    input.productId, input.variantId, input.expectedProfessionalVersion, input.expectedPolicyVersion, input.startsAt,
    customerKey, input.explicitOneOff === undefined ? null : ["one_off", input.explicitOneOff.reason ?? null]]);
  const prior = await tx.appointmentAudit.findUnique({ where: { merchantId_commandId: {
    merchantId: actor.merchantId, commandId: input.commandId } } });
  if (prior) {
    const receipt = prior.after;
    if (prior.action !== "manual_create" || prior.actorId !== actor.userId || !record(receipt)
      || receipt.requestFingerprint !== requestFingerprint || typeof receipt.professionalVersion !== "number"
      || !Number.isSafeInteger(receipt.professionalVersion) || receipt.professionalVersion < 1)
      throw new ConflictException("service_appointment_idempotency_conflict");
    const appointment = await tx.serviceAppointment.findFirst({ where: { id: prior.appointmentId,
      merchantId: actor.merchantId, professionalId: input.professionalId, origin: "manual" }, include: { payments: true } });
    if (!appointment || receipt.admissionFingerprint !== appointment.requestFingerprint
      || receipt.availabilityExceptionId !== appointment.availabilityExceptionId)
      throw new ConflictException("service_manual_receipt_invalid");
    return { appointment, replayed: true, professionalVersion: receipt.professionalVersion as number,
      availabilityExceptionId: appointment.availabilityExceptionId };
  }

  let facts = await readProfessionalServiceLink(tx, { merchantId: actor.merchantId, ...input });
  if (facts.professionalVersion !== input.expectedProfessionalVersion) throw new ConflictException("service_selection_stale");
  const merchant = await tx.merchant.findUnique({ where: { id: actor.merchantId }, select: {
    businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
  if (!merchant) throw new NotFoundException("merchant_not_found");
  const policyRow = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId: actor.merchantId } });
  const business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData: false, policy: policyRow });
  if (!business.capabilities.serviceBooking || !business.policy) throw new ConflictException("service_booking_" + business.bookingBlockReason);
  if (business.policyVersion !== input.expectedPolicyVersion) throw new ConflictException("service_policy_changed");
  const customer = await resolveCustomer(tx, actor, input.customer);
  const startsAt = new Date(input.startsAt), endsAt = new Date(startsAt.getTime() + facts.durationMinutes * 60_000);
  let exceptionId: string | null = null;
  if (input.explicitOneOff !== undefined) {
    const saved = await saveAvailabilityException(tx, actor, facts.professionalId, input.expectedProfessionalVersion, {
      kind: "one_off", startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), timeZone: facts.timeZone,
      ...(input.explicitOneOff.reason !== undefined ? { reason: input.explicitOneOff.reason } : {}),
    });
    exceptionId = saved.exception.id;
    facts = { ...facts, professionalVersion: saved.version };
  }
  const date = professionalLocalDate(startsAt, facts.timeZone);
  // Preparation is not the final decision clock: an actual lease read may wait.
  const available = await getProfessionalAvailability(tx, { merchantId: actor.merchantId, productId: facts.productId,
    variantId: facts.variantId, professionalId: facts.professionalId, fromDate: date, toDate: date,
    expectedVersion: facts.professionalVersion, now: clock(context) });
  const slot = available.slots.find(value => value.startsAt === startsAt.toISOString() && value.endsAt === endsAt.toISOString());
  if (available.status !== "ready" || !slot) throw new ConflictException("service_slot_unavailable");
  const selected: ProfessionalCheckoutSelection = { productId: facts.productId, variantId: facts.variantId,
    professionalId: facts.professionalId, professionalVersion: facts.professionalVersion, policyVersion: input.expectedPolicyVersion,
    date, startsAt: slot.startsAt, endsAt: slot.endsAt, timeZone: slot.timeZone, durationMinutes: slot.durationMinutes,
    priceInCents: facts.priceInCents, currency: facts.currency, slotId: "" };
  selected.slotId = professionalSlotId(actor.merchantId, selected);
  const leaseOwner = { ownerId: digest(["manual-lease-v1", actor.merchantId, actor.userId, input.commandId]),
    store: context.store ?? serviceSlotStore };
  await acquireProfessionalLease(actor.merchantId, [selected], business.policy, leaseOwner);
  let decisionAt!: Date;
  const admitted = await admitServiceAppointment(tx, { merchantId: actor.merchantId, productId: facts.productId,
    variantId: facts.variantId, professionalId: facts.professionalId, professionalVersion: facts.professionalVersion,
    policyVersion: input.expectedPolicyVersion, date, startsAt: slot.startsAt, endsAt: slot.endsAt,
    priceInCents: facts.priceInCents, currency: facts.currency, ...customer, actorId: actor.userId, origin: "manual",
    idempotencyKey: input.commandId, confirmation: { kind: business.policy.paymentMode === "at_attendance" ? "at_attendance" : "pending" } },
  { clock: () => { decisionAt = clock(context); return decisionAt; }, leaseOwner, leaseSelections: [selected] });
  if (business.policy.paymentMode === "at_attendance") await ensureAtAttendancePayment(tx, admitted.appointment, decisionAt);
  const appointment = await tx.serviceAppointment.update({ where: { id: admitted.appointment.id, merchantId: actor.merchantId },
    data: { availabilityExceptionId: exceptionId }, include: { payments: true } });
  await tx.appointmentAudit.update({ where: { merchantId_commandId: { merchantId: actor.merchantId, commandId: input.commandId } },
    data: { action: "manual_create", after: { requestFingerprint, admissionFingerprint: appointment.requestFingerprint,
      professionalVersion: facts.professionalVersion, availabilityExceptionId: exceptionId,
      operationalStatus: appointment.operationalStatus, policyVersion: appointment.policyVersion,
      priceInCents: appointment.priceInCents, currency: appointment.currency } } });
  return { appointment, replayed: false, professionalVersion: facts.professionalVersion, availabilityExceptionId: exceptionId };
}

export class CreateManualServiceAppointmentUseCase {
  constructor(private readonly prisma: PrismaClient, private readonly events?: DomainEventBus) {}
  async execute(actor: ServiceActor, input: ManualServiceAppointmentCommand, context: ManualContext = {}) {
    const result = await this.prisma.$transaction(tx => createManualServiceAppointmentWithin(tx, actor, input, context));
    // Matches existing T22 writer semantics: optional availability notification only after commit.
    if (!result.replayed && result.availabilityExceptionId) await this.events?.publish({ eventType: "service.availability.changed",
      merchantId: actor.merchantId, schemaVersion: 1, payload: { professionalId: result.appointment.professionalId, version: result.professionalVersion } });
    return result;
  }
}
