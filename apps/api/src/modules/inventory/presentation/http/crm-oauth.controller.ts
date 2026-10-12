import { Controller, Get, Header, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { HubSpotOAuthService } from "../../application/services/hubspot-oauth.service.js";

@ApiTags("Inventory - CRM OAuth")
@Controller("inventory/crm/oauth/hubspot")
@UseGuards(AuthGuard)
export class CrmOAuthController {
  constructor(private readonly hubspot: HubSpotOAuthService) {}

  @Get("authorize")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Authorize this merchant's HubSpot account" })
  authorize(@Req() request: any) {
    return this.hubspot.authorize(currentUser(request));
  }

  @Get("callback")
  async callback(@Req() request: any, @Res() response: any,
    @Query("state") state?: string, @Query("code") code?: string, @Query("error") error?: string) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    let result: "connected" | "denied" | "failed" = "failed";
    try {
      const connection = await this.hubspot.complete(currentUser(request), state ?? "", code, Boolean(error));
      result = connection ? "connected" : "denied";
    } catch { /* Never reflect provider messages, codes, or tokens into the redirect. */ }
    response.redirect(302, this.hubspot.dashboardRedirect(result));
  }
}
