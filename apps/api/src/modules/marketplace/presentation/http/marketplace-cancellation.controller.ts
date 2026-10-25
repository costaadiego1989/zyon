import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { MarketplaceCancellationDashboardService } from "../../application/marketplace-cancellation-dashboard.service.js";
import type { MarketplaceCancellationReason } from "../../domain/ports/marketplace-cancellation-execution.port.js";

const reasons: readonly MarketplaceCancellationReason[] = ["requested_by_customer", "abandoned", "duplicate", "fraudulent"];

// Do not require an active marketplace subscription to remediate an existing payment.
@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin")
@Controller("marketplace/dashboard/payments")
export class MarketplaceCancellationController {
  constructor(@Inject(MarketplaceCancellationDashboardService) private readonly cancellation: MarketplaceCancellationDashboardService) {}

  @Get()
  list(@Req() request: { user?: unknown }, @Query() query: Record<string, unknown>) {
    const hostMerchantId = this.host(request);
    if (Object.keys(query).some(key => !["limit", "cursor"].includes(key)) ||
        (query.limit !== undefined && (typeof query.limit !== "string" || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(query.limit))) ||
        (query.cursor !== undefined && typeof query.cursor !== "string")) throw new BadRequestException("invalid_marketplace_payment_query");
    if (typeof query.cursor === "string") this.validateId(query.cursor);
    return this.cancellation.list(hostMerchantId, query.limit === undefined ? 20 : Number(query.limit), query.cursor as string | undefined);
  }

  @Post(":paymentIntentId/cancel")
  async cancel(@Req() request: { user?: unknown }, @Param("paymentIntentId") paymentIntentId: string, @Body() body: unknown,
    @Res({ passthrough: true }) response: Response) {
    const hostMerchantId = this.host(request);
    this.validateId(paymentIntentId);
    const reason = this.reason(body);
    const result = await this.cancellation.cancel(hostMerchantId, paymentIntentId, reason);
    response.status(result.status === "pending" ? 202 : 200);
    return result;
  }

  @Get(":paymentIntentId/cancellation")
  status(@Req() request: { user?: unknown }, @Param("paymentIntentId") paymentIntentId: string) {
    const hostMerchantId = this.host(request);
    this.validateId(paymentIntentId);
    return this.cancellation.status(hostMerchantId, paymentIntentId);
  }

  private host(request: { user?: unknown }): string {
    const user = currentUser(request);
    if (user.role !== "owner" && user.role !== "admin") throw new ForbiddenException("marketplace_cancellation_forbidden");
    return user.merchantId;
  }

  private validateId(paymentIntentId: string): void {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(paymentIntentId)) throw new BadRequestException("invalid_payment_intent_id");
  }

  private reason(body: unknown): MarketplaceCancellationReason {
    const value = body === undefined ? {} : body;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "reason")) {
      throw new BadRequestException("invalid_marketplace_cancellation_request");
    }
    const supplied = (value as { reason?: unknown }).reason;
    const reason = supplied === undefined ? "requested_by_customer" : supplied;
    if (typeof reason !== "string" || !reasons.includes(reason as MarketplaceCancellationReason)) {
      throw new BadRequestException("invalid_marketplace_cancellation_reason");
    }
    return reason as MarketplaceCancellationReason;
  }
}
