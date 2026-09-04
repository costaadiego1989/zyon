import { Controller, Get, Post, Param, Query, Req, UseGuards, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

@Controller("merchants/:merchantId/notifications")
@UseGuards(AuthGuard)
export class MerchantNotificationController {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  @Get()
  async list(
    @Param("merchantId") merchantId: string,
    @Query("since") since?: string,
    @Req() request?: any,
  ) {
    const principal = currentUser(request);
    if (principal.merchantId !== merchantId) return { items: [] };

    const where: any = { merchantId };
    if (since) {
      where.createdAt = { gt: new Date(since) };
    }

    const items = await this.prisma.merchantNotification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return { items };
  }

  @Post(":notifId/read")
  async markRead(
    @Param("merchantId") merchantId: string,
    @Param("notifId") notifId: string,
    @Req() request?: any,
  ) {
    const principal = currentUser(request);
    if (principal.merchantId !== merchantId) return { ok: false };

    await this.prisma.merchantNotification.updateMany({
      where: { id: notifId, merchantId },
      data: { read: true },
    });
    return { ok: true };
  }

  @Post("read-all")
  async markAllRead(
    @Param("merchantId") merchantId: string,
    @Req() request?: any,
  ) {
    const principal = currentUser(request);
    if (principal.merchantId !== merchantId) return { ok: false };

    await this.prisma.merchantNotification.updateMany({
      where: { merchantId, read: false },
      data: { read: true },
    });
    return { ok: true };
  }
}
