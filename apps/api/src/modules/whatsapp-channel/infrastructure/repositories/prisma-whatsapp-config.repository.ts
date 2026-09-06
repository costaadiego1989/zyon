/**
 * Prisma WhatsApp Config Repository
 */

import { Injectable, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { WhatsAppConfigRepository, WhatsAppChannelConfigEntity } from "../../domain/ports/whatsapp-config-repository.port.js";

@Injectable()
export class PrismaWhatsAppConfigRepository implements WhatsAppConfigRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<WhatsAppChannelConfigEntity | null> {
    const row = await (this.prisma as any).whatsAppChannelConfig?.findUnique({ where: { id } });
    return row ? this.mapToEntity(row) : null;
  }

  async findByDeviceId(deviceId: string): Promise<WhatsAppChannelConfigEntity | null> {
    const rows = await this.prisma.whatsAppChannelConfig.findMany({
      where: { deviceId },
      take: 2,
    });
    if (rows.length > 1) throw new ServiceUnavailableException("whatsapp_device_ambiguous");
    const row = rows[0];
    return row ? this.mapToEntity(row) : null;
  }

  async findByMerchantId(merchantId: string): Promise<WhatsAppChannelConfigEntity | null> {
    const row = await (this.prisma as any).whatsAppChannelConfig?.findUnique({
      where: { merchantId },
    });
    return row ? this.mapToEntity(row) : null;
  }

  async findByWhatsAppNumber(whatsappNumber: string): Promise<WhatsAppChannelConfigEntity | null> {
    const row = await (this.prisma as any).whatsAppChannelConfig?.findFirst({
      where: { whatsappNumber },
    });
    return row ? this.mapToEntity(row) : null;
  }

  async findByMetaPhoneNumberId(phoneNumberId: string): Promise<WhatsAppChannelConfigEntity | null> {
    const row = await (this.prisma as any).whatsAppChannelConfig?.findFirst({
      where: { credentials: { path: ["phoneNumberId"], equals: phoneNumberId } },
    });
    return row ? this.mapToEntity(row) : null;
  }

  async upsert(merchantId: string, data: Partial<Omit<WhatsAppChannelConfigEntity, "id" | "merchantId" | "createdAt">>): Promise<WhatsAppChannelConfigEntity> {
    const row = await (this.prisma as any).whatsAppChannelConfig.upsert({
      where: { merchantId },
      create: {
        merchantId,
        enabled: data.enabled ?? false,
        provider: data.provider ?? "BUBBLEWHATS",
        credentials: data.credentials ?? {},
        whatsappNumber: data.whatsappNumber,
        status: data.status ?? "DISCONNECTED",
        deviceId: data.deviceId,
        phoneNumber: data.phoneNumber,
        webhookSecret: data.webhookSecret ?? crypto.randomUUID(),
      },
      update: data,
    });
    return this.mapToEntity(row);
  }

  private mapToEntity(row: any): WhatsAppChannelConfigEntity {
    return {
      id: row.id,
      merchantId: row.merchantId,
      enabled: row.enabled,
      provider: row.provider ?? "BUBBLEWHATS",
      credentials: row.credentials ?? {},
      whatsappNumber: row.whatsappNumber,
      status: row.status ?? "DISCONNECTED",
      deviceId: row.deviceId,
      phoneNumber: row.phoneNumber,
      webhookSecret: row.webhookSecret,
      connectedAt: row.connectedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
