import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { GetShippingTrackingUseCase, PurchaseShippingLabelUseCase } from "../../application/use-cases/shipping-label.use-cases.js";

@ApiTags("Shipping labels")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@Controller("shipping")
export class ShippingLabelController {
  constructor(
    private readonly purchaseLabel: PurchaseShippingLabelUseCase,
    private readonly getTracking: GetShippingTrackingUseCase,
  ) {}

  @Post("labels")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["orders:write"] })
  async purchase(@Req() request: unknown, @Body() body: PurchaseLabelDto) {
    return this.purchaseLabel.execute({
      merchantId: tenantId(request),
      externalOrderId: body.order_id,
      serviceId: body.service_id,
      fromZip: body.from_zip,
      toZip: body.to_zip,
      toName: body.to_name,
      toDocument: body.to_document,
      packages: body.packages,
      invoiceKey: body.invoice_key,
    });
  }

  @Get("tracking/:shipmentId")
  @RequireTenantAccess({ serviceScopes: ["tracking:read"] })
  async tracking(@Req() request: unknown, @Param("shipmentId") shipmentId: string) {
    return this.getTracking.execute({
      merchantId: tenantId(request),
      shipmentId,
    });
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(request as Parameters<typeof currentTenantPrincipal>[0]).tenantId;
}

export type PurchaseLabelDto = {
  order_id: string;
  service_id: number;
  from_zip: string;
  to_zip: string;
  to_name: string;
  to_document: string;
  packages: Array<{ weightKg: number; widthCm: number; heightCm: number; lengthCm: number; quantity: number }>;
  invoice_key?: string;
};
