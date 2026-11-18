import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, ServiceAppointment } from "@prisma/client";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { admitWhatsAppEffectInTransaction } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { assertExpectedVersion } from "../../catalog/domain/services/service-professional-input.js";
import { actionsForUnit } from "../domain/order-fulfillment.js";

export type AttendanceAction = "start_service" | "complete_service" | "no_show";
export interface AttendanceTransitionCommand {
  appointmentId: string;
  expectedVersion: number;
  commandId: string;
  action: AttendanceAction;
}
interface AttendanceContext { /** Internal server/test seam, never a body timestamp. */ clock?: () => Date }
export interface AttendanceTransitionResult { appointment: ServiceAppointment; replayed: boolean; appliedVersion: number }
type Status = ServiceAppointment["operationalStatus"];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown) => typeof value === "string" && value.trim() === value && !!value && value.length <= 191;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Explicit adapter: pending is an unconfirmed attempt, never legacy unscheduled
// service "pending". No Order or ServiceReservation record is consulted/created.
const legacyState: Record<Status, string> = { pending: "awaiting_confirmation", scheduled: "scheduled", in_service: "in_service",
  completed: "completed", no_show: "no_show", cancelled: "cancelled" };

export function attendanceTarget(status: Status, action: AttendanceAction): "in_service" | "completed" | "no_show" {
  // The pinned helper reads strategy/status only. This transient view adapts its
  // wider legacy type; it is not a persisted/public fulfillment/order projection.
  const stateView = { strategy: "scheduled_service" as const, status: legacyState[status] };
  const allowed = actionsForUnit(stateView as Parameters<typeof actionsForUnit>[0]).find(value => value.action === action);
  if (!allowed || !["in_service", "completed", "no_show"].includes(allowed.targetStatus))
    throw new ConflictException("service_attendance_action_not_allowed");
  // Only states/actions are reused. Order-specific requiresProof/clock/payment
  // restrictions are not requirements of the approved ServiceAppointment flow.
  return allowed.targetStatus as "in_service" | "completed" | "no_show";
}

function validate(input: AttendanceTransitionCommand) {
  if (!object(input) || Object.keys(input).some(key => !["appointmentId", "expectedVersion", "commandId", "action"].includes(key))
    || !id(input.appointmentId) || !id(input.commandId) || !["start_service", "complete_service", "no_show"].includes(input.action))
    throw new BadRequestException("service_attendance_command_invalid");
  assertExpectedVersion(input.expectedVersion);
}

/** Actor is the existing authenticated human tenant principal, never body data.
 * The caller must roll back on rejection; the class entrypoint owns the TX. */
export async function transitionServiceAppointmentWithin(tx: Prisma.TransactionClient, actor: ServiceActor,
  input: AttendanceTransitionCommand, context: AttendanceContext = {}): Promise<AttendanceTransitionResult> {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function")
    throw new BadRequestException("service_attendance_transaction_required");
  validate(input);
  input = { ...input }; // Freeze the original primitive command before any lock await.
  await admitWhatsAppEffectInTransaction(tx, actor.merchantId);
  await lockCatalogMerchant(tx, actor.merchantId);
  await assertServiceAdministration(tx, actor);
  const selected = await tx.serviceAppointment.findFirst({ where: { id: input.appointmentId, merchantId: actor.merchantId },
    select: { professionalId: true } });
  if (!selected) throw new NotFoundException("service_appointment_not_found");
  await lockServiceProfessional(tx, actor.merchantId, selected.professionalId);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM service_appointments
    WHERE id = ${input.appointmentId} AND merchant_id = ${actor.merchantId} FOR UPDATE`;
  if (locked.length !== 1) throw new NotFoundException("service_appointment_not_found");
  const appointment = await tx.serviceAppointment.findFirst({ where: { id: input.appointmentId, merchantId: actor.merchantId } });
  if (!appointment || appointment.professionalId !== selected.professionalId) throw new ConflictException("service_appointment_version_conflict");
  const fingerprint = hash(["service-attendance-v1", actor.merchantId, actor.userId, input.appointmentId,
    input.action, input.expectedVersion]);
  const prior = await tx.appointmentAudit.findUnique({ where: { merchantId_commandId: {
    merchantId: actor.merchantId, commandId: input.commandId } } });
  if (prior) {
    const receipt = prior.after;
    if (prior.appointmentId !== appointment.id || prior.actorId !== actor.userId || prior.action !== input.action
      || prior.version !== input.expectedVersion + 1 || !object(receipt) || receipt.requestFingerprint !== fingerprint
      || receipt.version !== prior.version || appointment.version < prior.version)
      throw new ConflictException("service_appointment_idempotency_conflict");
    // Return current canonical state, which may include a later explicit action;
    // never reset it to the historical target or emit another audit/event.
    return { appointment, replayed: true, appliedVersion: prior.version };
  }
  if (appointment.version !== input.expectedVersion) throw new ConflictException("service_appointment_version_conflict");
  const target = attendanceTarget(appointment.operationalStatus, input.action);
  const now = context.clock ? context.clock() : new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BadRequestException("service_attendance_clock_invalid");
  // Time only timestamps this explicit command. It cannot infer presence,
  // completion/absence, settle finance, or introduce an unrequired time gate.
  const timestamp = input.action === "start_service" ? { startedAt: now }
    : input.action === "complete_service" ? { completedAt: now } : { noShowAt: now };
  const version = input.expectedVersion + 1;
  const changed = await tx.serviceAppointment.updateMany({ where: { id: appointment.id, merchantId: actor.merchantId,
    version: input.expectedVersion, operationalStatus: appointment.operationalStatus },
    data: { operationalStatus: target, version: { increment: 1 }, ...timestamp, updatedAt: now } });
  if (changed.count !== 1) throw new ConflictException("service_appointment_version_conflict");
  await tx.appointmentAudit.create({ data: { merchantId: actor.merchantId, appointmentId: appointment.id,
    commandId: input.commandId, version, action: input.action, actorId: actor.userId, origin: "operator", occurredAt: now,
    before: { operationalStatus: appointment.operationalStatus, version: appointment.version },
    after: { operationalStatus: target, version, requestFingerprint: fingerprint, occurredAt: now.toISOString() } } });
  const eventType = "service.appointment." + target;
  const eventId = hash([actor.merchantId, appointment.id, version, eventType]);
  await tx.outboxMessage.create({ data: { eventId, eventType, schemaVersion: 1, merchantId: actor.merchantId,
    occurredAt: now, correlationId: appointment.id, causationId: input.commandId, producer: "service-booking",
    payload: { appointmentId: appointment.id, version, operationalStatus: target } } });
  const current = await tx.serviceAppointment.findFirst({ where: { id: appointment.id, merchantId: actor.merchantId } });
  if (!current || current.version !== version || current.operationalStatus !== target)
    throw new ConflictException("service_appointment_version_conflict");
  return { appointment: current, replayed: false, appliedVersion: version };
}

export class TransitionServiceAppointmentUseCase {
  constructor(private readonly prisma: PrismaClient) {}
  execute(actor: ServiceActor, input: AttendanceTransitionCommand, context: AttendanceContext = {}) {
    return this.prisma.$transaction(tx => transitionServiceAppointmentWithin(tx, actor, input, context));
  }
}
