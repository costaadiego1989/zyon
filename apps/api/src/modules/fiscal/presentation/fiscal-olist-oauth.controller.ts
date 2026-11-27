import { Body, Controller, Get, Inject, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../auth/presentation/tenant-role.guard.js";
import { RequireTenantRoles } from "../../auth/presentation/tenant-role.decorator.js";
import type { TenantPrincipalRequest } from "../../../shared/auth/tenant-principal.js";
import { FISCAL_OLIST_OAUTH, type FiscalOlistOAuthPort, type OlistAuthorizationInput } from "../domain/fiscal-olist-oauth.port.js";
import { fiscalHttp, fiscalHttpActor } from "./fiscal-http.js";

@RequireTenantRoles("owner", "admin")
@UseGuards(AuthGuard, TenantRoleGuard)
@Controller("merchants/me/fiscal/olist/oauth")
export class FiscalOlistOAuthController {
  constructor(@Inject(FISCAL_OLIST_OAUTH) private readonly oauth: FiscalOlistOAuthPort) {}
  @Get("configuration") configuration(@Req() req: TenantPrincipalRequest, @Query("environment") environment: string) {
    const { scope } = fiscalHttpActor(req, environment);
    return fiscalHttp(async () => this.oauth.configuration(scope));
  }
  @Post("authorize") authorize(@Req() req: TenantPrincipalRequest, @Body() body: OlistAuthorizationInput & { environment: string }) {
    const { scope, actor } = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() => this.oauth.start(scope, actor, body));
  }
  @Post("complete") complete(@Req() req: TenantPrincipalRequest, @Body() body: { environment: string; state: string; code: string }) {
    const { scope, actor } = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() => this.oauth.complete(scope, actor, body.state, body.code));
  }
}

@Controller("webhooks/fiscal/olist/oauth")
export class FiscalOlistOAuthCallbackController {
  constructor(@Inject(FISCAL_OLIST_OAUTH) private readonly oauth: FiscalOlistOAuthPort) {}
  @Get("callback")
  async callback(@Query("state") state: unknown, @Query("code") code: unknown, @Query("error") error: unknown, @Res() response: Response) {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Referrer-Policy", "no-referrer");
    return response.redirect(302, await fiscalHttp(() => this.oauth.callback(state, code, error)));
  }
}
