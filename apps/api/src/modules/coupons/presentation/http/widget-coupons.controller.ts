import { Controller, Post, Delete, Body } from "@nestjs/common";
import type { Cart } from "@aacp/shared-types";
import { ApplyCouponUseCase } from "../../application/use-cases/apply-coupon.use-case.js";

@Controller("embed/coupons")
export class WidgetCouponsController {
  constructor(private readonly applyCoupon: ApplyCouponUseCase) {}

  @Post("apply")
  async apply(@Body() body: {
    session_id: string;
    merchant_id: string;
    code: string;
    cart: Cart;
    buyer_global_user_id?: string;
    buyer_region?: string;
  }) {
    return this.applyCoupon.execute({ ...body, source: "manual" });
  }
}
