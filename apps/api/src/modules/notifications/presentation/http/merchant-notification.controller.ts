import { Controller, Get, Post, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { ManageMerchantNotificationInboxUseCase } from "../../application/use-cases/manage-merchant-notification-inbox.use-case.js";

@Controller("merchants/:merchantId/notifications")
@UseGuards(AuthGuard)
export class MerchantNotificationController {
  constructor(private readonly inbox: ManageMerchantNotificationInboxUseCase) {}

  @Get()
  async list(
    @Param("merchantId") merchantId: string,
    @Query("since") since?: string,
    @Req() request?: any,
  ) {
    const principal = currentUser(request);
    if (principal.merchantId !== merchantId) return { items: [] };

    return { items: await this.inbox.list(merchantId, since) };
  }

  @Post(":notifId/read")
  async markRead(
    @Param("merchantId") merchantId: string,
    @Param("notifId") notifId: string,
    @Req() request?: any,
  ) {
    const principal = currentUser(request);
    if (principal.merchantId !== merchantId) return { ok: false };

    await this.inbox.markRead(merchantId, notifId);
    return { ok: true };
  }

  @Post("read-all")
  async markAllRead(
    @Param("merchantId") merchantId: string,
    @Req() request?: any,
  ) {
    const principal = currentUser(request);
    if (principal.merchantId !== merchantId) return { ok: false };

    await this.inbox.markAllRead(merchantId);
    return { ok: true };
  }
}
