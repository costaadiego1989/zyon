import { assertLeaseCaptureUnusedWithin, captureAppointmentLease, findAppointmentLeaseWithin, noAppointmentLease,
  type OwnedAppointmentLease } from "../../../shared/bookings/appointment-lease-proof.js";
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, ServiceAppointment } from "@prisma/client";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { admitWhatsAppEffectInTransaction } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { professionalSlotId, professionalHoldRequests, type ProfessionalCheckoutSelection } from "../../../shared/bookings/service-checkout-selection.js";
import { originalSlotLeaseProof, serviceSlotStore, type RedisServiceSlots } from "../../../shared/bookings/redis-service-slots.js";
import { readProfessionalServiceLink } from "../../catalog/domain/services/professional-service-link.js";
import { professionalLocalDate } from "../../catalog/domain/services/professional-availability.js";
import { parseServiceInstant } from "../../catalog/domain/services/professional-availability-input.js";
import { assertExpectedVersion } from "../../catalog/domain/services/service-professional-input.js";
import { getProfessionalAvailability } from "../../catalog/application/get-professional-availability.js";
import { resolveServiceBusinessPolicy } from "../../merchant/domain/service-business-policy.js";
import { readCancellationPoliciesWithin } from "./cancel-service-appointment.use-case.js";
import { SERVICE_APPOINTMENT_RESCHEDULE_HOLD_CLEANUP } from "./service-appointment-hold-cleanup.consumer.js";

type RescheduleLeaseStore = Pick<RedisServiceSlots, "acquire" | "acquireForAppointmentReschedule" | "assertActive" | "releaseCaptured">;
interface RescheduleContext { clock?: () => Date; store?: () => RescheduleLeaseStore }
function clock(context: RescheduleContext): Date {
  const now = context.clock ? context.clock() : new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BadRequestException("service_reschedule_clock_invalid");
  return now;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown) => typeof value === "string" && !!value && value.trim() === value && value.length <= 191;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface RescheduleDestination { professionalId: string; expectedProfessionalVersion: number; startsAt: string }
export interface RescheduleQuote {
  merchantId: string; appointmentId: string; version: number; productId: string; variantId: string; professionalId: string;
  professionalVersion: number; policyVersion: number; policyHash: string; startsAt: string; endsAt: string; timeZone: string;
  durationMinutes: number; priceInCents: number; currency: string; paymentMode: string; holdEnabled: boolean; holdMinutes: number | null;
}
export interface ReschedulePreview { appointmentId: string; expectedVersion: number; destination: RescheduleDestination }
export interface RescheduleCommand extends ReschedulePreview {
  commandId: string; operatorRequestId?: string; requestMessageId?: string; policyHash: string; acceptedQuoteHash: string;
}
export function validateRescheduleDestination(value: unknown): RescheduleDestination {
  if (!object(value) || Object.keys(value).some(key => !["professionalId", "expectedProfessionalVersion", "startsAt"].includes(key)) || !id(value.professionalId))
    throw new BadRequestException("service_reschedule_destination_invalid");
  assertExpectedVersion(value.expectedProfessionalVersion);
  return { professionalId: value.professionalId as string, expectedProfessionalVersion: value.expectedProfessionalVersion as number,
    startsAt: parseServiceInstant(value.startsAt).toISOString() };
}
export function rescheduleQuoteFingerprint(q: RescheduleQuote): string {
  return digest(["service-reschedule-quote-v1", q.merchantId, q.appointmentId, q.version, q.productId, q.variantId, q.professionalId,
    q.professionalVersion, q.policyVersion, q.policyHash, q.startsAt, q.endsAt, q.timeZone, q.durationMinutes, q.priceInCents, q.currency,
    q.paymentMode, q.holdEnabled, q.holdMinutes]);
}
function validate(value: ReschedulePreview | RescheduleCommand, commit: boolean) {
  const keys = ["appointmentId", "expectedVersion", "destination", ...(commit ? ["commandId", "operatorRequestId", "requestMessageId", "policyHash", "acceptedQuoteHash"] : [])];
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) || !id(value.appointmentId)) throw new BadRequestException("service_reschedule_command_invalid");
  assertExpectedVersion(value.expectedVersion); const destination = validateRescheduleDestination(value.destination);
  if (commit) {
    const c = value as RescheduleCommand;
    if (!id(c.commandId) || c.operatorRequestId !== undefined && !id(c.operatorRequestId)
      || c.requestMessageId !== undefined && !id(c.requestMessageId) || id(c.operatorRequestId) === id(c.requestMessageId)
      || typeof c.policyHash !== "string" || !/^[a-f0-9]{64}$/.test(c.policyHash)
      || typeof c.acceptedQuoteHash !== "string" || !/^[a-f0-9]{64}$/.test(c.acceptedQuoteHash))
      throw new BadRequestException("service_reschedule_command_invalid");
  }
  return { ...value, destination };
}
async function locked(tx: Prisma.TransactionClient, actor: ServiceActor, input: ReschedulePreview) {
  await admitWhatsAppEffectInTransaction(tx, actor.merchantId); await lockCatalogMerchant(tx, actor.merchantId); await assertServiceAdministration(tx, actor);
  const selected = await tx.serviceAppointment.findFirst({ where: { id: input.appointmentId, merchantId: actor.merchantId }, select: { professionalId: true } });
  if (!selected) throw new NotFoundException("service_appointment_not_found");
  for (const professionalId of [...new Set([selected.professionalId, input.destination.professionalId])].sort()) await lockServiceProfessional(tx, actor.merchantId, professionalId);
  await tx.$queryRaw`SELECT id FROM service_appointments WHERE id=${input.appointmentId} AND merchant_id=${actor.merchantId} FOR UPDATE`;
  const a = await tx.serviceAppointment.findFirst({ where: { id: input.appointmentId, merchantId: actor.merchantId } });
  if (!a || a.professionalId !== selected.professionalId) throw new ConflictException("service_appointment_version_conflict");
  return a;
}
async function quoteWithin(tx: Prisma.TransactionClient, actor: ServiceActor, input: ReschedulePreview, a: ServiceAppointment, context: RescheduleContext) {
  if (a.version !== input.expectedVersion) throw new ConflictException("service_appointment_version_conflict");
  if (!["pending", "scheduled"].includes(a.operationalStatus)) throw new ConflictException("service_reschedule_state_conflict");
  const facts = await readProfessionalServiceLink(tx, { merchantId: actor.merchantId, productId: a.productId, variantId: a.variantId, professionalId: input.destination.professionalId });
  if (facts.professionalVersion !== input.destination.expectedProfessionalVersion) throw new ConflictException("service_selection_stale");
  const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: actor.merchantId } });
  const policy = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId: actor.merchantId } });
  const business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData: false, policy });
  if (!business.capabilities.serviceBooking || !business.policy) throw new ConflictException("service_booking_" + business.bookingBlockReason);
  const policies = await readCancellationPoliciesWithin(tx, actor.merchantId), startsAt = new Date(input.destination.startsAt);
  const endsAt = new Date(startsAt.getTime() + facts.durationMinutes * 60_000), date = professionalLocalDate(startsAt, facts.timeZone), now = clock(context);
  const available = await getProfessionalAvailability(tx, { merchantId: actor.merchantId, productId: a.productId, variantId: a.variantId,
    professionalId: facts.professionalId, fromDate: date, toDate: date, expectedVersion: facts.professionalVersion, now },
    { excludeAppointment: { appointmentId: a.id, expectedVersion: a.version } });
  if (available.status !== "ready" || !available.slots.some(slot => slot.startsAt === startsAt.toISOString() && slot.endsAt === endsAt.toISOString()))
    throw new ConflictException("service_slot_unavailable");
  const quote: RescheduleQuote = { merchantId: actor.merchantId, appointmentId: a.id, version: a.version, productId: a.productId, variantId: a.variantId,
    professionalId: facts.professionalId, professionalVersion: facts.professionalVersion, policyVersion: business.policyVersion!, policyHash: policies.hash,
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), timeZone: facts.timeZone, durationMinutes: facts.durationMinutes,
    priceInCents: facts.priceInCents, currency: facts.currency, paymentMode: business.policy.paymentMode, holdEnabled: business.policy.holdEnabled, holdMinutes: business.policy.holdMinutes };
  const balances = await tx.appointmentPayment.findMany({ where: { merchantId: actor.merchantId, appointmentId: a.id }, take: 101 });
  if (balances.length > 100) throw new ServiceUnavailableException("service_financial_facts_limit");
  const receipt = balances.length ? await tx.attendanceReceipt.findFirst({ where: { merchantId: actor.merchantId, appointmentPaymentId: { in: balances.map(row => row.id) } }, select: { id: true } }) : null;
  const bookedMode = object(a.policySnapshot) ? a.policySnapshot.paymentMode : undefined;
  const priceChanged = a.priceInCents !== quote.priceInCents || a.currency !== quote.currency;
  const lockedMoney = !!a.orderId || !!receipt || balances.some(row => row.mode === "online" || row.status !== "pending" || !!row.receivedAt || !!row.paymentIntentId || !!row.providerPaymentId);
  const requiresSeparateFinancialReview = quote.paymentMode !== bookedMode || priceChanged && lockedMoney;
  return { quote, quoteHash: rescheduleQuoteFingerprint(quote), requiresSeparateFinancialReview, business, balances, date };
}
function commercial(a: ServiceAppointment) {
  return { professionalId: a.professionalId, startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), timeZone: a.timeZone,
    durationMinutes: a.durationMinutes, priceInCents: a.priceInCents, currency: a.currency, policyVersion: a.policyVersion, version: a.version };
}
export class RescheduleServiceAppointmentUseCase {
  constructor(private readonly prisma: PrismaClient) {}
  preview(actor: ServiceActor, raw: ReschedulePreview, context: RescheduleContext = {}) {
    const input = validate(raw, false);
    actor = { ...actor };
    return this.prisma.$transaction(async tx => { const a = await locked(tx, actor, input); const result = await quoteWithin(tx, actor, input, a, context);
      return { quote: result.quote, quoteHash: result.quoteHash, requiresSeparateFinancialReview: result.requiresSeparateFinancialReview }; });
  }
  async execute(actor: ServiceActor, raw: RescheduleCommand, context: RescheduleContext = {}) {
    const input = validate(raw, true) as RescheduleCommand;
    actor = { ...actor };
    let callbackRejected = false, prepared: { store: RescheduleLeaseStore; capture: OwnedAppointmentLease } | undefined;
    try { return await this.prisma.$transaction(async tx => { try {
      const a = await locked(tx, actor, input), fingerprint = digest(["service-reschedule-command-v1", actor.merchantId, actor.userId,
        input.appointmentId, input.expectedVersion, input.destination, input.operatorRequestId ?? null, input.requestMessageId ?? null, input.policyHash, input.acceptedQuoteHash]);
      const prior = await tx.appointmentAudit.findUnique({ where: { merchantId_commandId: { merchantId: actor.merchantId, commandId: input.commandId } } });
      if (prior) {
        if (prior.appointmentId !== a.id || prior.actorId !== actor.userId || prior.action !== "reschedule" || !object(prior.after)
          || prior.after.requestFingerprint !== fingerprint || prior.version !== input.expectedVersion + 1 || a.version < prior.version)
          throw new ConflictException("service_appointment_idempotency_conflict");
        return { appointment: a, replayed: true, appliedVersion: prior.version };
      }
      const current = await quoteWithin(tx, actor, input, a, context), q = current.quote;
      if (input.policyHash !== q.policyHash || input.acceptedQuoteHash !== current.quoteHash) throw new ConflictException("service_reschedule_quote_changed");
      if (current.requiresSeparateFinancialReview) throw new ConflictException("service_reschedule_financial_review_required");
      let request: Prisma.InputJsonObject = { kind: "operator_request", requestId: input.operatorRequestId!, operatorId: actor.userId, acceptedQuoteHash: current.quoteHash };
      if (input.requestMessageId) {
        const intake = a.buyerGlobalUserId ? await tx.supportTicketMessage.findFirst({ where: { id: input.requestMessageId, senderType: "buyer",
          ticket: { merchantId: actor.merchantId, buyerId: a.buyerGlobalUserId, source: "whatsapp" } }, include: { ticket: true } }) : null;
        const metadata = intake?.metadata;
        if (!intake || intake.id !== input.requestMessageId || intake.senderType !== "buyer" || intake.ticket.merchantId !== actor.merchantId
          || intake.ticket.buyerId !== a.buyerGlobalUserId || intake.ticket.source !== "whatsapp"
          || !object(metadata) || metadata.kind !== "whatsapp_intake" || metadata.schemaVersion !== 1 || metadata.appointmentId !== a.id || metadata.policyVersion !== a.policyVersion)
          throw new NotFoundException("service_reschedule_request_not_found");
        request = { kind: "buyer_handoff_operator_acceptance", requestMessageId: intake.id, ticketId: intake.ticket.id, operatorId: actor.userId, acceptedQuoteHash: current.quoteHash };
      }
      const selection: ProfessionalCheckoutSelection = { productId: q.productId, variantId: q.variantId, professionalId: q.professionalId,
        professionalVersion: q.professionalVersion, policyVersion: q.policyVersion, date: current.date, startsAt: q.startsAt, endsAt: q.endsAt,
        timeZone: q.timeZone, durationMinutes: q.durationMinutes, priceInCents: q.priceInCents, currency: q.currency, slotId: "" };
      selection.slotId = professionalSlotId(actor.merchantId, selection);
      const binding = await findAppointmentLeaseWithin(tx, a);
      if (!binding && object(a.policySnapshot) && a.policySnapshot.holdEnabled === true)
        throw new ConflictException("service_hold_original_proof_required");
      const original = binding?.capture.kind === "owned" ? binding : undefined;
      // A failed invocation's late compensation must never select a retry lease.
      const nextOwner = digest(["service-reschedule-lease-v1", actor.merchantId, actor.userId, input.commandId, randomUUID()]);
      const policy = current.business.policy!;
      if (policy.holdEnabled && !policy.holdMinutes) throw new ConflictException("service_hold_required");
      const slots = professionalHoldRequests([selection]), target = slots[0];
      let lease = noAppointmentLease(target, "hold_off") as ReturnType<typeof noAppointmentLease> | OwnedAppointmentLease;
      if (policy.holdEnabled) {
        const store = (context.store ?? serviceSlotStore)();
        const held = original?.capture.kind === "owned"
          ? await store.acquireForAppointmentReschedule(actor.merchantId, nextOwner, slots, policy.holdMinutes! * 60_000, original.capture)
          : await store.acquire(actor.merchantId, nextOwner, slots, policy.holdMinutes! * 60_000);
        lease = captureAppointmentLease(actor.merchantId, nextOwner, originalSlotLeaseProof(held), target);
        prepared = { store, capture: lease };
      }
      // Lease IO may wait. Refresh the availability decision after it; network
      // or clock cannot confirm an expired/nonexistent slot or settle money.
      const final = await quoteWithin(tx, actor, input, a, context);
      if (final.quoteHash !== current.quoteHash) throw new ConflictException("service_reschedule_quote_changed");
      if (prepared) {
        const active = captureAppointmentLease(actor.merchantId, nextOwner, await prepared.store.assertActive(actor.merchantId, nextOwner, slots), target);
        if (digest(active) !== digest(prepared.capture)) throw new ConflictException("service_reschedule_destination_lease_changed");
      }
      await assertLeaseCaptureUnusedWithin(tx, actor.merchantId, lease);
      const now = clock(context), version = a.version + 1;
      if (Date.parse(q.startsAt) <= now.getTime()) throw new ConflictException("service_slot_unavailable");
      const changed = await tx.serviceAppointment.updateMany({ where: { id: a.id, merchantId: actor.merchantId, version: a.version, operationalStatus: a.operationalStatus }, data: {
        professionalId: q.professionalId, startsAt: new Date(q.startsAt), endsAt: new Date(q.endsAt), timeZone: q.timeZone, durationMinutes: q.durationMinutes,
        priceInCents: q.priceInCents, currency: q.currency, policyVersion: q.policyVersion, policySnapshot: { ...current.business.policy! },
        availabilityExceptionId: null, version: { increment: 1 }, updatedAt: now } });
      if (changed.count !== 1) throw new ConflictException("service_appointment_version_conflict");
      if (a.priceInCents !== q.priceInCents || a.currency !== q.currency) for (const balance of current.balances) {
        const updated = await tx.appointmentPayment.updateMany({ where: { id: balance.id, merchantId: actor.merchantId, version: balance.version,
          mode: "at_attendance", status: "pending", receivedAt: null }, data: { amountCents: q.priceInCents, currency: q.currency, version: { increment: 1 } } });
        if (updated.count !== 1) throw new ConflictException("service_financial_version_conflict");
      }
      await tx.serviceReservation.updateMany({ where: { merchantId: actor.merchantId, appointmentId: a.id, status: "reserved" },
        data: { startsAt: new Date(q.startsAt), endsAt: new Date(q.endsAt) } });
      const after = { ...q, version, requestFingerprint: fingerprint, request,
        privateLease: lease, ...(original ? { privateLeaseCleanup: { originalAuditId: original.auditId } } : {}) } as unknown as Prisma.InputJsonValue;
      await tx.appointmentAudit.create({ data: { merchantId: actor.merchantId, appointmentId: a.id, commandId: input.commandId, version,
        action: "reschedule", actorId: actor.userId, origin: "operator", occurredAt: now, before: commercial(a), after } });
      const eventType = "service.appointment.rescheduled";
      await tx.outboxMessage.create({ data: { eventId: digest([actor.merchantId, a.id, version, eventType]), eventType, schemaVersion: 1,
        merchantId: actor.merchantId, occurredAt: now, correlationId: a.id, causationId: input.commandId, producer: "service-booking",
        payload: { appointmentId: a.id, version, operationalStatus: a.operationalStatus } } });
      if (original) await tx.outboxMessage.create({ data: {
        eventId: digest([actor.merchantId, a.id, version, SERVICE_APPOINTMENT_RESCHEDULE_HOLD_CLEANUP]),
        eventType: SERVICE_APPOINTMENT_RESCHEDULE_HOLD_CLEANUP, schemaVersion: 1, merchantId: actor.merchantId, occurredAt: now,
        correlationId: a.id, causationId: input.commandId, producer: "service-booking-private",
        payload: { originalAuditId: original.auditId, appointmentId: a.id, rescheduleVersion: version },
      } });
      return { appointment: await tx.serviceAppointment.findFirstOrThrow({ where: { id: a.id, merchantId: actor.merchantId } }), replayed: false, appliedVersion: version };
    } catch (error) { callbackRejected = true; throw error; } });
    } catch (error) {
      // A resolved callback followed by a COMMIT/transport error is ambiguous.
      // Keep its possibly committed lease; receipt replay reconciles the result.
      if (callbackRejected && prepared) {
        try { await prepared.store.releaseCaptured(actor.merchantId, prepared.capture); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], "service_reschedule_rollback_cleanup_failed"); }
      }
      throw error;
    }
  }
}
