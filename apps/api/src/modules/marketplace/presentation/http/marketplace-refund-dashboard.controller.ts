import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { MarketplaceRefundDashboardService } from "../../application/marketplace-refund-dashboard.service.js";

@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin")
@Controller("marketplace/dashboard/refunds")
export class MarketplaceRefundDashboardController {
  constructor(@Inject(MarketplaceRefundDashboardService) private readonly refunds: MarketplaceRefundDashboardService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Req() request: { user?: unknown }, @Query() query: Record<string, unknown>) {
    const host = this.host(request);
    if (Object.keys(query).some(key => !["limit", "cursor"].includes(key)) ||
      (query.limit !== undefined && (typeof query.limit !== "string" || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(query.limit)))) throw new BadRequestException("invalid_marketplace_refund_query");
    if (query.cursor !== undefined) this.id(query.cursor);
    return this.refunds.list(host, query.limit === undefined ? 20 : Number(query.limit), query.cursor as string | undefined);
  }

  @Get(":refundId")
  @Header("Cache-Control", "no-store")
  detail(@Req() request: { user?: unknown }, @Param("refundId") id: string) {
    const host = this.host(request); this.id(id); return this.refunds.detail(host, id);
  }

  @Post(":refundId/execute")
  @Header("Cache-Control", "no-store")
  async execute(@Req() request: { user?: unknown }, @Param("refundId") id: string, @Body() body: unknown,
    @Res({ passthrough: true }) response: Response) {
    const host = this.host(request); this.id(id);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["confirmed", "expected_amount_cents"].includes(key))) throw new BadRequestException("invalid_marketplace_refund_confirmation");
    const value = body as { confirmed?: unknown; expected_amount_cents?: unknown };
    if (value.confirmed !== true || !Number.isSafeInteger(value.expected_amount_cents) || Number(value.expected_amount_cents) <= 0 || Number(value.expected_amount_cents) > 2_147_483_647) throw new BadRequestException("invalid_marketplace_refund_confirmation");
    const result = await this.refunds.execute(host, id, Number(value.expected_amount_cents));
    response.status(result.status === "pending" ? 202 : 200); return result;
  }
  private host(request: { user?: unknown }): string {
    const user = currentUser(request);
    if (!["owner", "admin"].includes(user.role)) throw new ForbiddenException("marketplace_refund_forbidden");
    return user.merchantId;
  }
  private id(value: unknown): void {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new BadRequestException("invalid_marketplace_refund_id");
  }
}
