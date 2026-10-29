import { BadRequestException, Controller, ForbiddenException, Get, Header, Inject, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { MarketplaceShipmentDashboardService } from "../../application/marketplace-shipment-dashboard.service.js";

@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin")
@Controller("marketplace/dashboard/shipments")
export class ShippingShipmentDashboardController {
  constructor(@Inject(MarketplaceShipmentDashboardService) private readonly dashboard: MarketplaceShipmentDashboardService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Req() request: { user?: unknown }, @Query() query: Record<string, unknown>) {
    const user = currentUser(request);
    if (user.role !== "owner" && user.role !== "admin") throw new ForbiddenException("marketplace_shipment_recovery_forbidden");
    if (Object.keys(query).some(key => !["limit", "cursor"].includes(key)) ||
      (query.limit !== undefined && (typeof query.limit !== "string" || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(query.limit))) ||
      (query.cursor !== undefined && (typeof query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(query.cursor)))) {
      throw new BadRequestException("invalid_marketplace_shipment_query");
    }
    return this.dashboard.list(user.merchantId, query.limit === undefined ? 20 : Number(query.limit), query.cursor as string | undefined);
  }
}
