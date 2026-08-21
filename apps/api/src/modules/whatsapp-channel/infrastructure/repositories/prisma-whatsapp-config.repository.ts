/**
 * Prisma WhatsApp Config Repository
 */

import { Injectable, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { WhatsAppConfigRepository, WhatsAppChannelConfigEntity } from "../../domain/ports/whatsapp-config-repository.port.js";

@Injectable()
export class PrismaWhatsAppConfigRepository implements WhatsAppConfigRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findByDeviceId(deviceId: string): Promise<WhatsAppChannelConfigEntity | null> {
    const row = await (this.prisma as any).whatsAppChannelConfig?.findFirst({
      where: { deviceId },
    });
    return row ?? null;
  }

  async findByMerchantId(merchantId: string): Promise<WhatsAppChannelConfigEntity | null> {
    const row = await (this.prisma as any).whatsAppChannelConfig?.findUnique({
      where: { merchantId },
    });
    return row ?? null;
  }

  async upsert(merchantId: string, data: Partial<Omit<WhatsAppChannelConfigEntity, "id" | "merchantId" | "createdAt">>): Promise<WhatsAppChannelConfigEntity> {
    const row = await (this.prisma as any).whatsAppChannelConfig.upsert({
      where: { merchantId },
      create: {
        merchantId,
        enabled: data.enabled ?? false,
        deviceId: data.deviceId ?? "",
        phoneNumber: data.phoneNumber ?? "",
        webhookSecret: data.webhookSecret ?? crypto.randomUUID(),
      },
      update: data,
    });
    return row;
  }
}
