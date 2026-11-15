import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { assertExpectedVersion, assertServiceTimeZone } from "../domain/services/service-professional-input.js";
import { assertAvailabilityMinutePrecision, parseServiceInstant } from "../domain/services/professional-availability-input.js";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import type { DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";

export interface AvailabilityExceptionInput {
  id?: string;
  kind: "one_off" | "block";
  startsAt: string;
  endsAt: string;
  timeZone: string;
  reason?: string | null;
  isActive?: boolean;
}

export function validateAvailabilityException(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("invalid_availability_exception");
  const input = raw as AvailabilityExceptionInput;
  if (Object.keys(input).some(key => !["id", "kind", "startsAt", "endsAt", "timeZone", "reason", "isActive"].includes(key)) || !["one_off", "block"].includes(input.kind)
    || (input.id !== undefined && (typeof input.id !== "string" || !input.id || input.id.length > 191)) || (input.isActive !== undefined && typeof input.isActive !== "boolean")
    || (input.reason != null && (typeof input.reason !== "string" || input.reason.length > 1200))) throw new BadRequestException("invalid_availability_exception");
  assertServiceTimeZone(input.timeZone);
  const startsAt = parseServiceInstant(input.startsAt), endsAt = parseServiceInstant(input.endsAt);
  if (startsAt >= endsAt) throw new BadRequestException("invalid_availability_interval");
  if (input.isActive !== false || !input.id) { assertAvailabilityMinutePrecision(startsAt); assertAvailabilityMinutePrecision(endsAt); }
  return { ...input, startsAt, endsAt };
}

export async function saveAvailabilityException(tx: Prisma.TransactionClient, actor: ServiceActor, professionalId: string, expectedVersion: number, raw: AvailabilityExceptionInput) {
  assertExpectedVersion(expectedVersion);
  const input = validateAvailabilityException(raw);
  await lockCatalogMerchant(tx, actor.merchantId);
  await assertServiceAdministration(tx, actor);
  await lockServiceProfessional(tx, actor.merchantId, professionalId);
  const professional = await tx.serviceProfessional.findFirst({ where: { id: professionalId, merchantId: actor.merchantId } });
  if (!professional) throw new NotFoundException("service_professional_not_found");
  if (!professional.isActive && input.isActive !== false) throw new ConflictException("service_professional_inactive");
  if (professional.version !== expectedVersion) throw new ConflictException("service_professional_stale");
  const before = input.id ? await tx.availabilityException.findFirst({ where: { id: input.id, merchantId: actor.merchantId, professionalId } }) : null;
  if (input.id && !before) throw new NotFoundException("availability_exception_not_found");
  if (!(before && input.isActive === false) && professional.timeZone !== input.timeZone) throw new BadRequestException("availability_timezone_mismatch");
  if (input.isActive !== false) {
    const occupied = await tx.serviceAppointment.findFirst({ where: { merchantId: actor.merchantId, professionalId,
      operationalStatus: { in: ["scheduled", "in_service", "completed", "no_show"] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } }, select: { id: true } });
    if (occupied) throw new ConflictException("availability_appointment_conflict");
    if (input.kind === "one_off" && await tx.availabilityException.findFirst({ where: { merchantId: actor.merchantId, professionalId, isActive: true, kind: "block",
      ...(input.id ? { id: { not: input.id } } : {}), startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } }, select: { id: true } })) throw new ConflictException("availability_block_conflict");
  }
  const interval = before && input.isActive === false ? { kind: before.kind, startsAt: before.startsAt, endsAt: before.endsAt, timeZone: before.timeZone, reason: before.reason }
    : { kind: input.kind, startsAt: input.startsAt, endsAt: input.endsAt, timeZone: input.timeZone, reason: input.reason ?? null };
  const data = { ...interval,
    actorId: actor.userId, isActive: input.isActive ?? true };
  const exception = before ? await tx.availabilityException.update({ where: { id: before.id, merchantId: actor.merchantId }, data: { ...data, version: { increment: 1 } } })
    : await tx.availabilityException.create({ data: { ...data, merchantId: actor.merchantId, professionalId } });
  const changed = await tx.serviceProfessional.updateMany({ where: { id: professionalId, merchantId: actor.merchantId, version: expectedVersion }, data: { version: { increment: 1 } } });
  if (changed.count !== 1) throw new ConflictException("service_professional_stale");
  return { professionalId, version: expectedVersion + 1, exception };
}

export class SaveAvailabilityExceptionUseCase {
  constructor(private readonly prisma: PrismaClient, private readonly events?: DomainEventBus) {}

  async execute(actor: ServiceActor, professionalId: string, expectedVersion: number, raw: AvailabilityExceptionInput) {
    const result = await this.prisma.$transaction(tx => saveAvailabilityException(tx, actor, professionalId, expectedVersion, raw));
    await this.events?.publish({ eventType: "service.availability.changed", merchantId: actor.merchantId, schemaVersion: 1, payload: { professionalId, version: result.version } });
    return result;
  }
}
