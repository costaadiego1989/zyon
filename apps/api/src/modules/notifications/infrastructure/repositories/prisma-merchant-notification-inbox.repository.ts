import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { MerchantNotificationInboxPort } from "../../domain/ports/merchant-notification-inbox.port.js";

@Injectable()
export class PrismaMerchantNotificationInboxRepository implements MerchantNotificationInboxPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  list(merchantId: string, since?: Date): Promise<unknown[]> {
    return this.prisma.merchantNotification.findMany({
      where: { merchantId, ...(since ? { createdAt: { gt: since } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  async markRead(merchantId: string, notificationId: string): Promise<void> {
    await this.prisma.merchantNotification.updateMany({ where: { id: notificationId, merchantId }, data: { read: true } });
  }

  async markAllRead(merchantId: string): Promise<void> {
    await this.prisma.merchantNotification.updateMany({ where: { merchantId, read: false }, data: { read: true } });
  }
}
