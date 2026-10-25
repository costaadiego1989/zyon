import { BadRequestException, Body, Controller, ForbiddenException, Header, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { ReconcileMarketplaceDisputeClosureUseCase } from "../../application/use-cases/reconcile-marketplace-dispute-closure.use-case.js";

@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin")
@Controller("marketplace/dashboard/disputes")
export class MarketplaceDisputeClosureController {
  constructor(@Inject(ReconcileMarketplaceDisputeClosureUseCase) private readonly closure: ReconcileMarketplaceDisputeClosureUseCase) {}

  @Post(":paymentId/reconcile")
  @Header("Cache-Control", "no-store")
  reconcile(@Req() request: TenantPrincipalRequest, @Param("paymentId") paymentId: string, @Body() body: unknown) {
    const host = this.host(request); this.id(paymentId);
    const value = this.body(body, false);
    return this.closure.execute(host, paymentId, value.provider_dispute_id);
  }

  @Post(":paymentId/principal-extinctions")
  @Header("Cache-Control", "no-store")
  extinguishPrincipal(@Req() request: TenantPrincipalRequest, @Param("paymentId") paymentId: string, @Body() body: unknown) {
    const hostMerchantId = this.host(request); this.id(paymentId);
    const value = this.body(body, true);
    return this.closure.extinguishPrincipal({ hostMerchantId, paymentIntentId: paymentId,
      providerDisputeId: value.provider_dispute_id, debtId: value.debt_id! });
  }

  private host(request: TenantPrincipalRequest): string {
    const principal = currentTenantPrincipal(request);
    if (principal.kind !== "human" || !["owner", "admin"].includes(principal.role)) {
      throw new ForbiddenException("marketplace_dispute_closure_forbidden");
    }
    return principal.tenantId;
  }
  private id(value: unknown): void {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
      throw new BadRequestException("invalid_marketplace_dispute_identity");
    }
  }
  private body(body: unknown, extinction: boolean): { provider_dispute_id: string; debt_id?: string } {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key =>
      !["provider_dispute_id", ...(extinction ? ["debt_id"] : [])].includes(key))) {
      throw new BadRequestException("invalid_marketplace_dispute_command");
    }
    const value = body as Record<string, unknown>;
    if (typeof value.provider_dispute_id !== "string" || !/^(dp|du)_[A-Za-z0-9_]{1,100}$/.test(value.provider_dispute_id)) {
      throw new BadRequestException("invalid_marketplace_dispute_command");
    }
    if (extinction) this.id(value.debt_id);
    return {provider_dispute_id: value.provider_dispute_id, ...(extinction ? {debt_id: value.debt_id as string} : {})};
  }
}
