import { enqueueCanonicalPublicBusinessSources } from "../../graph-rag/infrastructure/public-business-write.js";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { assertExpectedVersion } from "../domain/services/service-professional-input.js";
import { validateRecurringAvailability, type RecurringAvailabilityInput } from "../domain/services/professional-availability-input.js";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import type { DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { FIXED_SERVICE_TIME_ZONE, assertNewServiceTimeZone, defaultNewServiceTimeZone } from "../domain/services/fixed-service-time-zone.js";

export class SaveProfessionalAvailabilityUseCase {
  constructor(private readonly prisma: PrismaClient, private readonly events?: DomainEventBus) {}

  async execute(actor: ServiceActor, professionalId: string, expectedVersion: number, raw: Omit<RecurringAvailabilityInput, "timeZone"> & { timeZone?: string }) {
    assertExpectedVersion(expectedVersion);
    const input = validateRecurringAvailability(defaultNewServiceTimeZone(raw));
    const explicitTimeZone = Object.hasOwn(raw, "timeZone") && raw.timeZone !== undefined;
    const result = await this.prisma.$transaction(async tx => {
      await lockCatalogMerchant(tx, actor.merchantId);
      await assertServiceAdministration(tx, actor);
      await lockServiceProfessional(tx, actor.merchantId, professionalId);
      const professional = await tx.serviceProfessional.findFirst({ where: { id: professionalId, merchantId: actor.merchantId } });
      if (!professional) throw new NotFoundException("service_professional_not_found");
      if (!professional.isActive) throw new ConflictException("service_professional_inactive");
      if (professional.version !== expectedVersion) throw new ConflictException("service_professional_stale");
      const retiring = input.rows.length === 0;
      // Empty rows retire the stored grade. They cannot relabel historical facts.
      if (!retiring || input.timeZone !== professional.timeZone) assertNewServiceTimeZone(input.timeZone);
      if (!retiring && professional.timeZone !== FIXED_SERVICE_TIME_ZONE && !explicitTimeZone)
        throw new BadRequestException("explicit_brasilia_grade_required");
      const timeZone = retiring ? professional.timeZone : FIXED_SERVICE_TIME_ZONE;
      await tx.professionalAvailability.updateMany({ where: { merchantId: actor.merchantId, professionalId, isActive: true }, data: { isActive: false } });
      if (input.rows.length) await tx.professionalAvailability.createMany({ data: input.rows.map(row => ({ ...row, merchantId: actor.merchantId, professionalId, version: expectedVersion + 1 })) });
      const changed = await tx.serviceProfessional.updateMany({ where: { id: professionalId, merchantId: actor.merchantId, version: expectedVersion }, data: { timeZone, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("service_professional_stale");
      await enqueueCanonicalPublicBusinessSources(tx, actor.merchantId, [{ sourceType: "professional", sourceId: professionalId }]);
      return { professionalId, version: expectedVersion + 1, timeZone, rows: await tx.professionalAvailability.findMany({ where: { merchantId: actor.merchantId, professionalId, isActive: true }, orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] }) };
    });
    await this.events?.publish({ eventType: "service.availability.changed", merchantId: actor.merchantId, schemaVersion: 1, payload: { professionalId, version: result.version } });
    return result;
  }
}
