import { Body, Controller, Get, Header, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { ShippingWalletService, type ShippingWalletAlertSettings } from "../../application/shipping-wallet.service.js";

@ApiTags("Shipping wallet")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({ humanOnly: true, humanRoles: ["owner", "admin"] })
@Controller("merchants/me/delivery/melhor-envio/wallet")
export class ShippingWalletController {
  constructor(private readonly wallet: ShippingWalletService) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  get(@Req() request: TenantPrincipalRequest, @Query("refresh") refresh?: string) {
    return this.wallet.get(currentTenantPrincipal(request).tenantId, refresh === "1");
  }
  @Put("alert")
  @Header("Cache-Control", "private, no-store")
  configure(@Req() request: TenantPrincipalRequest, @Body() body: ShippingWalletAlertSettings) {
    return this.wallet.configure(currentTenantPrincipal(request).tenantId, body);
  }
}
