import { Controller, Get, Post, Delete, Body, Param, Query } from "@nestjs/common";
import { CreateCouponUseCase, type CreateCouponInput } from "../../application/use-cases/create-coupon.use-case.js";
import { ArchiveCouponUseCase } from "../../application/use-cases/archive-coupon.use-case.js";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { Inject } from "@nestjs/common";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";

@NonProductionRoute()
@Controller("merchant/coupons")
export class MerchantCouponsController {
  constructor(
    private readonly createCoupon: CreateCouponUseCase,
    private readonly archiveCoupon: ArchiveCouponUseCase,
    @Inject(COUPON_REPOSITORY) private readonly repo: CouponRepository
  ) {}

  @Post()
  async create(@Body() body: CreateCouponInput) {
    return this.createCoupon.execute(body);
  }

  @Get()
  async list(@Query("merchant_id") merchantId: string) {
    return this.repo.findAllByMerchant(merchantId);
  }

  @Delete(":id")
  async archive(@Param("id") id: string, @Body() body: { merchant_id: string }) {
    return this.archiveCoupon.execute({ id, merchant_id: body.merchant_id });
  }
}
