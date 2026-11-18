import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Query, Req, ServiceUnavailableException, UseGuards, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../auth/presentation/tenant-role.guard.js";
import { RequireTenantRoles } from "../../auth/presentation/tenant-role.decorator.js";
import type { TenantPrincipalRequest } from "../../../shared/auth/tenant-principal.js";
import { FiscalWebhookDispatchError } from "../../../shared/integrations/fiscal-webhook-dispatch.port.js";
import { FISCAL_OLIST_NOTIFICATIONS, type FiscalOlistNotificationsPort } from "../domain/fiscal-olist-notifications.port.js";
import { fiscalHttp, fiscalHttpActor } from "./fiscal-http.js";

@RequireTenantRoles("owner", "admin")
@UseGuards(AuthGuard, TenantRoleGuard)
@Controller("merchants/me/fiscal/olist/connection/:id/notifications")
export class FiscalOlistNotificationsController {
  constructor(@Inject(FISCAL_OLIST_NOTIFICATIONS) private readonly notifications: FiscalOlistNotificationsPort) {}
  @Get() read(@Req() req: TenantPrincipalRequest, @Param("id") id: string, @Query("environment") environment: string) {
    const { scope } = fiscalHttpActor(req, environment); return fiscalHttp(() => this.notifications.read(scope, id));
  }
  @Post() configure(@Req() req: TenantPrincipalRequest, @Param("id") id: string, @Body() body: { environment: string; rotate?: boolean }) {
    const { scope, actor } = fiscalHttpActor(req, body.environment); return fiscalHttp(() => this.notifications.configure(scope, id, actor, body.rotate === true));
  }
}

@Controller("webhooks/fiscal/olist")
export class FiscalOlistNotificationCallbackController {
  constructor(@Inject(FISCAL_OLIST_NOTIFICATIONS) private readonly notifications: FiscalOlistNotificationsPort) {}
  @Post(":connectionRef/notification")
  @HttpCode(200)
  async receive(@Param("connectionRef") id: string, @Query("key") key: unknown, @Req() request: RawBodyRequest<Request>) {
    try { return await this.notifications.receive(id, key, request.rawBody); }
    catch (error) { if (error instanceof FiscalWebhookDispatchError) throw new HttpException(error.message, error.status); throw new ServiceUnavailableException("fiscal_webhook_unavailable"); }
  }
}
