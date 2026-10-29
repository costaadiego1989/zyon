import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { ExecuteMarketplaceShipmentService } from "../../application/use-cases/execute-marketplace-shipment.service.js";

/** Existing shipping obligations remain recoverable after a plan downgrade. */
@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin")
@Controller("marketplace/dashboard/shipments")
export class ShippingShipmentRecoveryController {
  constructor(@Inject(ExecuteMarketplaceShipmentService) private readonly shipments: ExecuteMarketplaceShipmentService) {}

  @Get(":shipmentId/recovery")
  @Header("Cache-Control", "no-store")
  status(@Req() request: { user?: unknown }, @Param("shipmentId") shipmentId: string) {
    const user = this.user(request); this.validateId(shipmentId);
    return this.shipments.recoveryStatus(user.merchantId, shipmentId);
  }

  @Post(":shipmentId/print-link")
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  async print(@Req() request: { user?: unknown }, @Param("shipmentId") shipmentId: string, @Body() body: unknown,
    @Res({ passthrough: true }) response: Response) {
    const user = this.user(request); this.validateId(shipmentId);
    // Identity, carrier account, environment and private mode come only from
    // the frozen journal. The browser cannot supply a URL or carrier proof.
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
      throw new BadRequestException("invalid_marketplace_shipment_print_request");
    }
    const result = await this.shipments.print(user.merchantId, shipmentId);
    response.status(200);
    return result;
  }

  @Post(":shipmentId/recover-cart")
  @Header("Cache-Control", "no-store")
  async recover(@Req() request: { user?: unknown }, @Param("shipmentId") shipmentId: string, @Body() body: unknown,
    @Res({ passthrough: true }) response: Response) {
    const user = this.user(request); this.validateId(shipmentId);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(body, "carrierOrderId") || typeof (body as { carrierOrderId?: unknown }).carrierOrderId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test((body as { carrierOrderId: string }).carrierOrderId)) {
      throw new BadRequestException("invalid_marketplace_shipment_recovery_request");
    }
    const result = await this.shipments.recoverCart(user.merchantId, shipmentId, (body as { carrierOrderId: string }).carrierOrderId, user.userId);
    response.status(result.recovery_status === "confirmed" ? 200 : 202);
    return result;
  }

  private user(request: { user?: unknown }) {
    const user = currentUser(request);
    if (user.role !== "owner" && user.role !== "admin") throw new ForbiddenException("marketplace_shipment_recovery_forbidden");
    return user;
  }

  private validateId(id: string): void {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new BadRequestException("invalid_shipment_id");
  }
}
