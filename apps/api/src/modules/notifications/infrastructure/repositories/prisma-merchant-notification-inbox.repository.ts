import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { CreateMerchantNotificationInput, MerchantNotificationContact, MerchantNotificationInboxPort } from "../../domain/ports/merchant-notification-inbox.port.js";

@Injectable()
export class PrismaMerchantNotificationInboxRepository implements MerchantNotificationInboxPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  list(merchantId: string, since?: Date): Promise<unknown[]> {
    return this.prisma.merchantNotification.findMany({
      where: { merchantId, read: false, ...(since ? { createdAt: { gt: since } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  create(input: CreateMerchantNotificationInput): Promise<unknown> {
    return this.prisma.merchantNotification.create({
      data: {
        merchantId: input.merchantId,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  async getContact(merchantId: string): Promise<MerchantNotificationContact | null> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        name: true,
        budgetEmail: true,
        budgetWhatsapp: true,
        storeSettings: true,
        users: { select: { email: true }, orderBy: { createdAt: "asc" }, take: 1 },
        whatsappChannelConfig: {
          select: { enabled: true, status: true, whatsappNumber: true, phoneNumber: true },
        },
      },
    });
    if (!merchant) return null;
    const settings = (merchant.storeSettings as { company?: { email?: string; phone?: string } } | null) ?? {};
    const config = merchant.whatsappChannelConfig;
    const connected = Boolean(config?.enabled && config.status === "ACTIVE");
    return {
      merchantId: merchant.id,
      merchantName: merchant.name,
      ownerEmail: merchant.users[0]?.email ?? undefined,
      supportEmail: settings.company?.email ?? merchant.budgetEmail ?? undefined,
      whatsappPhone: connected ? (config?.whatsappNumber ?? config?.phoneNumber ?? settings.company?.phone ?? merchant.budgetWhatsapp ?? undefined) : undefined,
      whatsappConnected: connected,
    };
  }

  async markRead(merchantId: string, notificationId: string): Promise<void> {
    await this.prisma.merchantNotification.updateMany({ where: { id: notificationId, merchantId }, data: { read: true } });
  }

  async markAllRead(merchantId: string): Promise<void> {
    await this.prisma.merchantNotification.updateMany({ where: { merchantId, read: false }, data: { read: true } });
  }
}
