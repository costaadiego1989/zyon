import type { OnModuleInit } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { DomainEvent, DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { parseAppointmentLease, type OwnedAppointmentLease } from "../../../shared/bookings/appointment-lease-proof.js";
import { serviceSlotStore, type RedisServiceSlots } from "../../../shared/bookings/redis-service-slots.js";
import { withoutWhatsAppExecutionForVerifiedOperation } from "../../../shared/whatsapp/whatsapp-automation-context.js";

export const SERVICE_APPOINTMENT_HOLD_CLEANUP = "service.appointment.hold_cleanup_requested";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v && v.trim() === v && v.length <= 191;
type Pointer = { originalAuditId: string; appointmentId: string; cancelVersion: number };
type Claim = Pointer & { eventId: string; merchantId: string; commandId: string; token: string };
function pointer(value: unknown): Pointer | undefined {
  if (!object(value) || Object.keys(value).some(key => !["originalAuditId", "appointmentId", "cancelVersion"].includes(key))
    || !id(value.originalAuditId) || !id(value.appointmentId) || !Number.isSafeInteger(value.cancelVersion)
    || (value.cancelVersion as number) < 2) return;
  return { originalAuditId: value.originalAuditId, appointmentId: value.appointmentId, cancelVersion: value.cancelVersion as number };
}
function claim(event: DomainEvent): Claim {
  const token = Object.getOwnPropertyDescriptor(event, "deliveryLeaseToken"), payload = pointer(event.payload);
  if (event.eventType !== SERVICE_APPOINTMENT_HOLD_CLEANUP || event.schemaVersion !== 1 || !id(event.eventId)
    || !id(event.merchantId) || !id(event.causationId) || !payload || event.correlationId !== payload.appointmentId
    || !token || token.enumerable || !id(token.value)) throw new Error("service_hold_cleanup_claim_required");
  return { ...payload, eventId: event.eventId, merchantId: event.merchantId, commandId: event.causationId, token: token.value };
}

/** Only committed cancellation receipts can authorize this task-specific cleanup.
 * The normal outbox dispatcher owns retry/ack; a Redis error must propagate. */
export class ServiceAppointmentHoldCleanupConsumer implements OnModuleInit {
  constructor(private readonly prisma: PrismaClient, private readonly events: DomainEventBus,
    private readonly tenant: TenantContextService,
    private readonly store: () => Pick<RedisServiceSlots, "releaseCaptured"> = serviceSlotStore) {}
  onModuleInit(): void {
    this.events.subscribe(SERVICE_APPOINTMENT_HOLD_CLEANUP, event => this.handle(event), "service-appointment-hold-cleanup-v1");
  }
  async handle(event: DomainEvent): Promise<void> {
    const proof = claim(event), scope = this.tenant.get();
    if (scope && scope.merchantId !== proof.merchantId) throw new Error("service_hold_cleanup_scope_mismatch");
    const captured = await this.prisma.$transaction(async tx => {
      await this.assertClaim(tx, proof);
      return this.original(tx, proof);
    });
    await withoutWhatsAppExecutionForVerifiedOperation(() => this.tenant.run({ merchantId: proof.merchantId,
      userId: "service-appointment-hold-cleanup", role: "system" }, async () => {
      await this.store().releaseCaptured(proof.merchantId, captured);
      // A lost/expired claim cannot acknowledge work. Exact generation CAS makes
      // a retry safe if Redis succeeded before this final SQL read/normal ack.
      await this.prisma.$transaction(tx => this.assertClaim(tx, proof));
    }));
  }
  private async assertClaim(tx: Prisma.TransactionClient, proof: Claim): Promise<void> {
    const row = await tx.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: proof.merchantId } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const payload = pointer(row?.payload);
    if (!row || row.eventId !== proof.eventId || row.merchantId !== proof.merchantId || row.eventType !== SERVICE_APPOINTMENT_HOLD_CLEANUP
      || row.producer !== "service-booking-private" || row.schemaVersion !== 1 || row.status !== "processing"
      || row.leaseToken !== proof.token || row.correlationId !== proof.appointmentId || row.causationId !== proof.commandId
      || !(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime()) || !(row.leaseExpiresAt instanceof Date)
      || row.leaseExpiresAt <= clock.now || !payload || payload.originalAuditId !== proof.originalAuditId
      || payload.appointmentId !== proof.appointmentId || payload.cancelVersion !== proof.cancelVersion)
      throw new Error("service_hold_cleanup_lease_lost");
  }
  private async original(tx: Prisma.TransactionClient, proof: Claim): Promise<OwnedAppointmentLease> {
    const original = await tx.appointmentAudit.findFirst({ where: { id: proof.originalAuditId,
      merchantId: proof.merchantId, appointmentId: proof.appointmentId } });
    const cancelled = await tx.appointmentAudit.findFirst({ where: { merchantId: proof.merchantId,
      appointmentId: proof.appointmentId, commandId: proof.commandId, action: "cancel", version: proof.cancelVersion } });
    const current = await tx.serviceAppointment.findFirst({ where: { id: proof.appointmentId, merchantId: proof.merchantId } });
    const capture = parseAppointmentLease(object(original?.after) ? original.after.privateLease : undefined);
    const after = object(cancelled?.after) ? cancelled.after : undefined;
    if (!original || original.merchantId !== proof.merchantId || original.appointmentId !== proof.appointmentId
      || original.version >= proof.cancelVersion || !capture || capture.kind !== "owned" || capture.merchantId !== proof.merchantId
      || !cancelled || cancelled.merchantId !== proof.merchantId || cancelled.appointmentId !== proof.appointmentId
      || cancelled.action !== "cancel" || cancelled.commandId !== proof.commandId || cancelled.version !== proof.cancelVersion
      || after?.operationalStatus !== "cancelled" || after.version !== proof.cancelVersion || !object(after.privateLeaseCleanup)
      || after.privateLeaseCleanup.originalAuditId !== proof.originalAuditId
      || !current || current.id !== proof.appointmentId || current.merchantId !== proof.merchantId
      || current.operationalStatus !== "cancelled" || current.version < proof.cancelVersion
      || capture.target.resourceId !== "professional:" + current.professionalId
      || Date.parse(capture.target.startsAt) !== current.startsAt.getTime() || Date.parse(capture.target.endsAt) !== current.endsAt.getTime())
      throw new Error("service_hold_cleanup_original_required");
    return capture;
  }
}
