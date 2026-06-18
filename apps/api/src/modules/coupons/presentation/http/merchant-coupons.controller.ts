import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { CreateCouponUseCase } from "../../application/use-cases/create-coupon.use-case.js";
import { ArchiveCouponUseCase } from "../../application/use-cases/archive-coupon.use-case.js";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";

@NonProductionRoute()
@UseGuards(AuthGuard)
@Controller("merchant/coupons")
export class MerchantCouponsController {
  constructor(
    private readonly createCoupon: CreateCouponUseCase,
    private readonly archiveCoupon: ArchiveCouponUseCase,
    @Inject(COUPON_REPOSITORY) private readonly repo: CouponRepository
  ) {}

  @Post()
  async create(@Req() req: unknown, @Body() body: Omit<Parameters<CreateCouponUseCase["execute"]>[0], "merchant_id">) {
    // P3 fix: derive merchant_id from authenticated principal, never trust body
    const { merchantId } = currentUser(req as { user?: unknown });
    return this.createCoupon.execute({ ...body, merchant_id: merchantId });
  }

  @Get()
  async list(@Req() req: unknown) {
    // P3 fix: derive merchant_id from authenticated principal
    const { merchantId } = currentUser(req as { user?: unknown });
    return this.repo.findAllByMerchant(merchantId);
  }

  @Delete(":id")
  async archive(@Req() req: unknown, @Param("id") id: string) {
    // P3 fix: derive merchant_id from authenticated principal
    const { merchantId } = currentUser(req as { user?: unknown });
    return this.archiveCoupon.execute({ id, merchant_id: merchantId });
  }
}
