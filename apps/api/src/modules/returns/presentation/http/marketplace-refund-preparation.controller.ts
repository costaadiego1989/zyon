import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { MarketplaceRefundPreparationService } from "../../application/marketplace-refund-preparation.service.js";
import type { MarketplaceRefundComponents } from "../../../marketplace/domain/services/marketplace-refund-allocation.js";

@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin")
@Controller("marketplace/dashboard/refund-candidates")
export class MarketplaceRefundPreparationController {
  constructor(@Inject(MarketplaceRefundPreparationService) private readonly preparation: MarketplaceRefundPreparationService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  list(@Req() request: { user?: unknown }, @Query() query: Record<string, unknown>) {
    const host = this.host(request);
    if (Object.keys(query).some(key => !["limit", "cursor"].includes(key)) || (query.limit !== undefined &&
      (typeof query.limit !== "string" || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(query.limit)))) throw new BadRequestException("invalid_marketplace_return_query");
    if (query.cursor !== undefined) this.id(query.cursor);
    return this.preparation.list(host, query.limit === undefined ? 20 : Number(query.limit), query.cursor as string | undefined);
  }
  @Get(":returnId")
  @Header("Cache-Control", "no-store")
  detail(@Req() request: { user?: unknown }, @Param("returnId") returnId: string) {
    const host = this.host(request); this.id(returnId); return this.preparation.detail(host, returnId);
  }
  @Post(":returnId/prepare")
  @Header("Cache-Control", "no-store")
  prepare(@Req() request: { user?: unknown }, @Param("returnId") returnId: string, @Body() body: unknown) {
    const host = this.host(request); this.id(returnId);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 3 ||
      Object.keys(body).some(key => !["confirmed", "expected_preparation_hash", "components"].includes(key))) throw new BadRequestException("invalid_marketplace_return_confirmation");
    const value = body as { confirmed?: unknown; expected_preparation_hash?: unknown; components: MarketplaceRefundComponents };
    if (value.confirmed !== true || typeof value.expected_preparation_hash !== "string" || !/^[a-f0-9]{64}$/.test(value.expected_preparation_hash)) throw new BadRequestException("invalid_marketplace_return_confirmation");
    return this.preparation.prepare(host, returnId, value.expected_preparation_hash, value.components);
  }
  private host(request: { user?: unknown }): string {
    const user = currentUser(request); if (!["owner", "admin"].includes(user.role)) throw new ForbiddenException("marketplace_return_preparation_forbidden"); return user.merchantId;
  }
  private id(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new BadRequestException("invalid_marketplace_return_id"); }
}
