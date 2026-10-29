import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  currentTenantPrincipal,
  type TenantPrincipal,
} from "../../../../shared/auth/tenant-principal.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { ListPaymentChargebacksUseCase } from "../../application/use-cases/list-payment-chargebacks.use-case.js";

@ApiTags("Payment chargebacks")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({ humanOnly: true, humanRoles: ["owner", "admin"] })
@Controller("payments")
export class PaymentChargebacksController {
  constructor(private readonly listChargebacks: ListPaymentChargebacksUseCase) {}

  @Get("chargebacks")
  @ApiOperation({ summary: "List the merchant's own payment chargebacks" })
  list(@Req() request: unknown) {
    return this.listChargebacks.execute({
      merchantId: humanPrincipal(request).tenantId,
    });
  }
}

function humanPrincipal(
  request: unknown,
): Extract<TenantPrincipal, { kind: "human" }> {
  const principal = currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  );
  if (principal.kind !== "human") {
    throw new Error("human_principal_expected");
  }
  return principal;
}
