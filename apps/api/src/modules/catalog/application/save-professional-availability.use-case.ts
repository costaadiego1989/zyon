import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { assertExpectedVersion } from "../domain/services/service-professional-input.js";
import { validateRecurringAvailability, type RecurringAvailabilityInput } from "../domain/services/professional-availability-input.js";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import type { DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";

export class SaveProfessionalAvailabilityUseCase {
  constructor(private readonly prisma: PrismaClient, private readonly events?: DomainEventBus) {}

  async execute(actor: ServiceActor, professionalId: string, expectedVersion: number, raw: RecurringAvailabilityInput) {
    assertExpectedVersion(expectedVersion);
    const input = validateRecurringAvailability(raw);
    const result = await this.prisma.$transaction(async tx => {
      await lockCatalogMerchant(tx, actor.merchantId);
      await assertServiceAdministration(tx, actor);
      await lockServiceProfessional(tx, actor.merchantId, professionalId);
      const professional = await tx.serviceProfessional.findFirst({ where: { id: professionalId, merchantId: actor.merchantId } });
      if (!professional) throw new NotFoundException("service_professional_not_found");
      if (!professional.isActive) throw new ConflictException("service_professional_inactive");
      if (professional.version !== expectedVersion) throw new ConflictException("service_professional_stale");
      await tx.professionalAvailability.updateMany({ where: { merchantId: actor.merchantId, professionalId, isActive: true }, data: { isActive: false } });
      if (input.rows.length) await tx.professionalAvailability.createMany({ data: input.rows.map(row => ({ ...row, merchantId: actor.merchantId, professionalId, version: expectedVersion + 1 })) });
      const changed = await tx.serviceProfessional.updateMany({ where: { id: professionalId, merchantId: actor.merchantId, version: expectedVersion }, data: { timeZone: input.timeZone, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("service_professional_stale");
      return { professionalId, version: expectedVersion + 1, timeZone: input.timeZone, rows: await tx.professionalAvailability.findMany({ where: { merchantId: actor.merchantId, professionalId, isActive: true }, orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] }) };
    });
    await this.events?.publish({ eventType: "service.availability.changed", merchantId: actor.merchantId, schemaVersion: 1, payload: { professionalId, version: result.version } });
    return result;
  }
}
