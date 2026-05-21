import { BadRequestException, Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { Cart } from "@aacp/shared-types";
import { ApplyCouponUseCase } from "../../application/use-cases/apply-coupon.use-case.js";
import type { EmbedHttpRequest } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { EmbedCheckoutGuardHelper } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";

@UseGuards(EmbedAuthGuard)
@Controller("embed/coupons")
export class WidgetCouponsController {
  constructor(
    private readonly applyCoupon: ApplyCouponUseCase,
    private readonly embedGuards: EmbedCheckoutGuardHelper
  ) {}

  @Post("apply")
  async apply(@Req() request: EmbedHttpRequest, @Body() body: {
    session_id: string;
    merchant_id: string;
    code: string;
    cart: Cart;
    buyer_global_user_id?: string;
    buyer_region?: string;
  }) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string" || typeof body.code !== "string") {
      throw new BadRequestException("session_id_and_coupon_code_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.applyCoupon.execute({
      session_id: body.session_id.trim(),
      merchant_id: embed.merchantId,
      code: body.code.trim(),
      cart: body.cart,
      buyer_global_user_id:
        typeof body.buyer_global_user_id === "string" ? body.buyer_global_user_id.trim() : undefined,
      buyer_region: typeof body.buyer_region === "string" ? body.buyer_region.trim() : undefined,
      source: "manual"
    });
  }
}
