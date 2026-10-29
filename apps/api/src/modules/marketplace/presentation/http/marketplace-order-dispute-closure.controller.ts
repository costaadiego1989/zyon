import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { ReconcileMarketplaceOrderDisputeClosureUseCase } from "../../application/use-cases/reconcile-marketplace-order-dispute-closure.use-case.js";
import type { MarketplaceContributionActor } from "../../domain/ports/marketplace-refund-contribution-journal.port.js";

/** Host accounting commands consume independently verified native GET proof.
 * No submitted amount, provider account or proof is accepted from HTTP. */
@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin")
@Controller("marketplace/dashboard/order-disputes")
export class MarketplaceOrderDisputeClosureController {
  constructor(@Inject(ReconcileMarketplaceOrderDisputeClosureUseCase) private readonly useCase: ReconcileMarketplaceOrderDisputeClosureUseCase) {}

  @Get(":paymentId/context")
  @Header("Cache-Control", "no-store")
  context(@Req() req: TenantPrincipalRequest, @Param("paymentId") paymentId: string, @Query("provider_dispute_id") providerDisputeId: string) {
    const actor = this.actor(req); this.payment(paymentId); this.dispute(providerDisputeId);
    return this.useCase.context(actor, paymentId, providerDisputeId);
  }
  @Post(":paymentId/host-principal-extinction")
  @Header("Cache-Control", "no-store")
  extinguishHostPrincipal(@Req() req: TenantPrincipalRequest, @Param("paymentId") paymentId: string, @Body() body: unknown) {
    const actor = this.actor(req); this.payment(paymentId); const providerDisputeId = this.command(body);
    return this.useCase.extinguishHostPrincipal(actor, paymentId, providerDisputeId);
  }
  @Post(":paymentId/close")
  @Header("Cache-Control", "no-store")
  close(@Req() req: TenantPrincipalRequest, @Param("paymentId") paymentId: string, @Body() body: unknown) {
    const actor = this.actor(req); this.payment(paymentId); const providerDisputeId = this.command(body);
    return this.useCase.close(actor, paymentId, providerDisputeId);
  }
  private actor(req: TenantPrincipalRequest): MarketplaceContributionActor {
    const p = currentTenantPrincipal(req);
    if (p.kind !== "human" || !["owner", "admin"].includes(p.role)) throw new ForbiddenException("marketplace_order_dispute_human_approval_required");
    return { merchantId: p.tenantId, userId: p.userId };
  }
  private payment(value: unknown): void {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) this.invalid();
  }
  private dispute(value: unknown): void {
    if (typeof value !== "string" || !/^(dp|du)_[A-Za-z0-9_]{1,100}$/.test(value)) this.invalid();
  }
  private command(body: unknown): string {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "confirmed,provider_dispute_id") this.invalid();
    const value = body as Record<string, unknown>; if (value.confirmed !== true) this.invalid(); this.dispute(value.provider_dispute_id);
    return value.provider_dispute_id as string;
  }
  private invalid(): never { throw new BadRequestException("invalid_marketplace_order_dispute_confirmation"); }
}
