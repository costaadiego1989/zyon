import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { MarketplaceAsaasWalletReturnDashboardService } from "../../application/marketplace-asaas-wallet-return-dashboard.service.js";

@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin")
@Controller("marketplace/dashboard/asaas-wallet-returns")
export class MarketplaceAsaasWalletReturnController {
  constructor(@Inject(MarketplaceAsaasWalletReturnDashboardService) private readonly returns:
    Pick<MarketplaceAsaasWalletReturnDashboardService, "list" | "preview" | "approve" | "execute" | "observe">) {}
  @Get()
  @Header("Cache-Control", "no-store")
  list(@Req() request: TenantPrincipalRequest, @Query() query: Record<string, unknown>) {
    const actor = this.actor(request);
    if (!query || Object.keys(query).some(key => key !== "limit" && key !== "cursor") ||
      query.limit !== undefined && (typeof query.limit !== "string" || !/^(?:[1-9]|1[0-9]|20)$/.test(query.limit)) ||
      query.cursor !== undefined && (typeof query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,1000}$/.test(query.cursor))) throw new BadRequestException("invalid_marketplace_wallet_return_page");
    return this.returns.list(actor, query.limit === undefined ? 20 : Number(query.limit), query.cursor as string | undefined);
  }
  @Get("refunds/:refundId/payouts/:payoutId")
  @Header("Cache-Control", "no-store")
  preview(@Req() request: TenantPrincipalRequest, @Param("refundId") refundId: string, @Param("payoutId") payoutId: string) {
    const actor = this.actor(request); this.id(refundId); this.id(payoutId);
    return this.returns.preview(actor, refundId, payoutId);
  }
  @Post("refunds/:refundId/payouts/:payoutId/approve")
  @Header("Cache-Control", "no-store")
  approve(@Req() request: TenantPrincipalRequest, @Param("refundId") refundId: string, @Param("payoutId") payoutId: string, @Body() body: unknown) {
    const actor = this.actor(request); this.id(refundId); this.id(payoutId);
    const confirmed = this.confirmation(body, false);
    return this.returns.approve(actor, refundId, payoutId, confirmed.expected_amount_cents);
  }
  @Post(":journalId/execute")
  @Header("Cache-Control", "no-store")
  execute(@Req() request: TenantPrincipalRequest, @Param("journalId") id: string, @Body() body: unknown) {
    const actor = this.actor(request); this.id(id);
    const confirmed = this.confirmation(body, true);
    return this.returns.execute(actor, id, confirmed.expected_amount_cents, confirmed.expected_request_hash!);
  }
  @Get(":journalId")
  @Header("Cache-Control", "no-store")
  observe(@Req() request: TenantPrincipalRequest, @Param("journalId") id: string) {
    const actor = this.actor(request); this.id(id); return this.returns.observe(actor, id);
  }
  private actor(request: TenantPrincipalRequest) {
    const principal = currentTenantPrincipal(request);
    if (principal.kind !== "human" || !["owner", "admin"].includes(principal.role)) throw new ForbiddenException("marketplace_wallet_return_forbidden");
    return { sellerMerchantId: principal.tenantId, userId: principal.userId };
  }
  private id(value: unknown): void {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new BadRequestException("invalid_marketplace_wallet_return_id");
  }
  private confirmation(body: unknown, execution: boolean) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key =>
      !["confirmed", "expected_amount_cents", ...(execution ? ["expected_request_hash"] : [])].includes(key))) throw new BadRequestException("invalid_marketplace_wallet_return_confirmation");
    const value = body as { confirmed?: unknown; expected_amount_cents?: unknown; expected_request_hash?: unknown };
    if (value.confirmed !== true || !Number.isSafeInteger(value.expected_amount_cents) || Number(value.expected_amount_cents) < 1 ||
      Number(value.expected_amount_cents) > 2_147_483_647 || execution &&
      (typeof value.expected_request_hash !== "string" || !/^[a-f0-9]{64}$/.test(value.expected_request_hash))) throw new BadRequestException("invalid_marketplace_wallet_return_confirmation");
    return { expected_amount_cents: Number(value.expected_amount_cents), expected_request_hash: value.expected_request_hash as string | undefined };
  }
}
