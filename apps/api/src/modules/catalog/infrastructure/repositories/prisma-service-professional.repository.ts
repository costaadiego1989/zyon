import { enqueueCanonicalPublicBusinessSources } from "../../../graph-rag/infrastructure/public-business-write.js";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { assertExpectedVersion, validateProfessionalInput, type ServiceProfessionalInput } from "../../domain/services/service-professional-input.js";
import { assertServiceAdministration, type ServiceActor } from "../../../../shared/bookings/service-business-access.js";
import { lockServiceProfessional } from "../../../../shared/bookings/service-professional-lock.js";
import { lockCatalogMerchant } from "../../../../shared/persistence/catalog-stock-ledger.js";
import { assertNewServiceTimeZone, defaultNewServiceTimeZone } from "../../domain/services/fixed-service-time-zone.js";

const include = { services: { where: { isActive: true }, select: { id: true, productId: true, version: true } } } as const;

export class PrismaServiceProfessionalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(actor: ServiceActor, options: { limit?: number; cursor?: string } = {}) {
    await assertServiceAdministration(this.prisma, actor, false);
    const limit = options.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (options.cursor !== undefined && (typeof options.cursor !== "string" || options.cursor.length > 191))) throw new BadRequestException("invalid_professional_page");
    const rows = await this.prisma.serviceProfessional.findMany({ where: { merchantId: actor.merchantId, ...(options.cursor ? { id: { gt: options.cursor } } : {}) }, orderBy: { id: "asc" }, take: limit + 1, include });
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
  }

  async create(actor: ServiceActor, raw: Omit<ServiceProfessionalInput, "timeZone"> & { timeZone?: string }) {
    const input = validateProfessionalInput(defaultNewServiceTimeZone(raw));
    return this.prisma.$transaction(async tx => {
      await lockCatalogMerchant(tx, actor.merchantId);
      await assertServiceAdministration(tx, actor);
      await this.assertOffers(tx, actor.merchantId, input.productIds ?? []);
      assertNewServiceTimeZone(input.timeZone);
      const data = {
        merchantId: actor.merchantId, publicName: input.publicName, publicProfile: input.publicProfile as Prisma.InputJsonValue,
        timeZone: input.timeZone, isActive: input.isActive ?? true, isPublished: input.isActive === false ? false : input.isPublished ?? false,
      } satisfies Prisma.ServiceProfessionalUncheckedCreateInput;
      const professional = await tx.serviceProfessional.create({ data });
      if (input.productIds?.length) await tx.professionalService.createMany({ data: input.productIds.map((productId): Prisma.ProfessionalServiceCreateManyInput => ({ merchantId: actor.merchantId, professionalId: professional.id, productId })) });
      await enqueueCanonicalPublicBusinessSources(tx, actor.merchantId, [
        { sourceType: "professional", sourceId: professional.id },
        ...(input.productIds ?? []).map(sourceId => ({ sourceType: "service" as const, sourceId })),
      ]);
      return tx.serviceProfessional.findFirstOrThrow({ where: { id: professional.id, merchantId: actor.merchantId }, include });
    });
  }

  async update(actor: ServiceActor, id: string, expectedVersion: number, raw: Partial<ServiceProfessionalInput>) {
    assertExpectedVersion(expectedVersion);
    return this.prisma.$transaction(async tx => {
      await lockCatalogMerchant(tx, actor.merchantId);
      await assertServiceAdministration(tx, actor);
      await lockServiceProfessional(tx, actor.merchantId, id);
      const before = await tx.serviceProfessional.findFirst({ where: { id, merchantId: actor.merchantId } });
      if (!before) throw new NotFoundException("service_professional_not_found");
      if (before.version !== expectedVersion) throw new ConflictException("service_professional_stale");
      const previousLinks = await tx.professionalService.findMany({ where: { merchantId: actor.merchantId, professionalId: id, isActive: true }, select: { productId: true } });
      const input = validateProfessionalInput({ publicName: before.publicName, publicProfile: before.publicProfile, timeZone: before.timeZone, isActive: before.isActive, isPublished: before.isPublished, ...raw });
      await this.assertOffers(tx, actor.merchantId, input.productIds ?? []);
      const changed = await tx.serviceProfessional.updateMany({ where: { id, merchantId: actor.merchantId, version: expectedVersion }, data: {
        publicName: input.publicName, publicProfile: input.publicProfile as Prisma.InputJsonValue, timeZone: input.timeZone,
        isActive: input.isActive, isPublished: input.isActive === false ? false : input.isPublished, version: { increment: 1 },
      } });
      if (changed.count !== 1) throw new ConflictException("service_professional_stale");
      if (input.productIds) {
        await tx.professionalService.updateMany({ where: { merchantId: actor.merchantId, professionalId: id, isActive: true, productId: { notIn: input.productIds } }, data: { isActive: false, version: { increment: 1 } } });
        for (const productId of input.productIds) await tx.professionalService.upsert({ where: { merchantId_professionalId_productId: { merchantId: actor.merchantId, professionalId: id, productId } }, create: { merchantId: actor.merchantId, professionalId: id, productId }, update: { isActive: true, version: { increment: 1 } } });
      }
      await enqueueCanonicalPublicBusinessSources(tx, actor.merchantId, [
        { sourceType: "professional", sourceId: id },
        ...[...previousLinks.map(link => link.productId), ...(input.productIds ?? [])].map(sourceId => ({ sourceType: "service" as const, sourceId })),
      ]);
      return tx.serviceProfessional.findFirstOrThrow({ where: { id, merchantId: actor.merchantId }, include });
    });
  }

  deactivate(actor: ServiceActor, id: string, expectedVersion: number) {
    return this.update(actor, id, expectedVersion, { isActive: false, isPublished: false });
  }

  private async assertOffers(tx: Prisma.TransactionClient, merchantId: string, ids: string[]) {
    if (ids.length !== await tx.product.count({ where: { id: { in: ids }, merchantId, type: "service", deletedAt: null } })) throw new BadRequestException("professional_service_not_found");
  }
}
