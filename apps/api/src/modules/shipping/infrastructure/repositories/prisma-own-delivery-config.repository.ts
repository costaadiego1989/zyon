import { Injectable, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type {
  OwnDeliveryConfig,
  OwnDeliveryConfigRepository
} from "../../domain/ports/own-delivery-config.port.js";

@Injectable()
export class PrismaOwnDeliveryConfigRepository implements OwnDeliveryConfigRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getByMerchantId(merchantId: string): Promise<OwnDeliveryConfig | null> {
    const record = await (this.prisma as any).ownDeliveryConfig.findUnique({
      where: { merchantId }
    });

    if (!record) return null;

    return this.mapToDomain(record);
  }

  async save(config: OwnDeliveryConfig): Promise<OwnDeliveryConfig> {
    const record = await (this.prisma as any).ownDeliveryConfig.upsert({
      where: { merchantId: config.merchantId },
      create: {
        merchantId: config.merchantId,
        enabled: config.enabled,
        mode: config.mode,
        flatPriceCents: config.flatPriceCents,
        freeAboveCents: config.freeAboveCents,
        neighborhoods: config.neighborhoods,
        estimatedDays: config.estimatedDays
      },
      update: {
        enabled: config.enabled,
        mode: config.mode,
        flatPriceCents: config.flatPriceCents,
        freeAboveCents: config.freeAboveCents,
        neighborhoods: config.neighborhoods,
        estimatedDays: config.estimatedDays
      }
    });

    return this.mapToDomain(record);
  }

  private mapToDomain(record: any): OwnDeliveryConfig {
    return {
      id: record.id,
      merchantId: record.merchantId,
      enabled: record.enabled,
      mode: record.mode,
      flatPriceCents: record.flatPriceCents,
      freeAboveCents: record.freeAboveCents,
      neighborhoods: record.neighborhoods,
      estimatedDays: record.estimatedDays
    };
  }
}
