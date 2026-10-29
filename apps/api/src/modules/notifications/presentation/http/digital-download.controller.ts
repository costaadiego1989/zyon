import { Controller, Get, Post, Param, Query, Res, NotFoundException, ConflictException, UseGuards, Inject } from "@nestjs/common";
import { PublicRoute } from "../../../../shared/tenant/tenant.guard.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { DigitalFulfillmentService } from "../../application/services/digital-fulfillment.service.js";

@Controller()
export class DigitalDownloadController {
  constructor(@Inject(DigitalFulfillmentService) private readonly fulfillment: DigitalFulfillmentService) {}

  @Get("digital-downloads")
  @PublicRoute()
  async download(@Query("token") token: unknown, @Res() response: { setHeader(name: string, value: string): void; redirect(status: number, url: string): void }) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    let target: string;
    try { target = await this.fulfillment.resolve(token); } catch { throw new NotFoundException("digital_access_unavailable"); }
    response.redirect(302, target);
  }

  @Get("merchants/:merchantId/orders/:orderId/digital-access")
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  list(@Param("merchantId") merchantId: string, @Param("orderId") orderId: string) { return this.fulfillment.list(merchantId, orderId); }

  @Post("merchants/:merchantId/digital-deliveries/:deliveryId/retry")
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  async retry(@Param("merchantId") merchantId: string, @Param("deliveryId") deliveryId: string) {
    try { await this.fulfillment.retryBlocked(merchantId, deliveryId); } catch { throw new ConflictException("digital_delivery_retry_not_allowed"); }
    return { status: "queued" };
  }
}
