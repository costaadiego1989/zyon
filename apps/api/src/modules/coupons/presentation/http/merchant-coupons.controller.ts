import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards } from "@nestjs/common";
import { PlanLimitGuard, RequirePlanLimit } from "../../../payment/domain/billing-plan-guard.js";
import { Inject } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { CreateCouponUseCase } from "../../application/use-cases/create-coupon.use-case.js";
import { ArchiveCouponUseCase } from "../../application/use-cases/archive-coupon.use-case.js";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";

@UseGuards(AuthGuard)
@Controller("merchant/coupons")
export class MerchantCouponsController {
  constructor(
    private readonly createCoupon: CreateCouponUseCase,
    private readonly archiveCoupon: ArchiveCouponUseCase,
    @Inject(COUPON_REPOSITORY) private readonly repo: CouponRepository
  ) {}

  @Post()
  @UseGuards(PlanLimitGuard)
  @RequirePlanLimit("activeCoupons")
  async create(@Req() req: unknown, @Body() body: Omit<Parameters<CreateCouponUseCase["execute"]>[0], "merchant_id">) {
    const { merchantId } = currentUser(req as { user?: unknown });
    return this.createCoupon.execute({ ...body, merchant_id: merchantId });
  }

  @Get()
  async list(@Req() req: unknown) {
    const { merchantId } = currentUser(req as { user?: unknown });
    const entities = await this.repo.findAllByMerchant(merchantId);
    return entities.map((c) => c.snapshot());
  }

  @Patch(":id")
  async toggle(@Req() req: unknown, @Param("id") id: string, @Body() body: { is_active: boolean }) {
    const { merchantId } = currentUser(req as { user?: unknown });
    return this.repo.updateActive(merchantId, id, body.is_active);
  }

  @Delete(":id")
  async archive(@Req() req: unknown, @Param("id") id: string) {
    const { merchantId } = currentUser(req as { user?: unknown });
    return this.archiveCoupon.execute({ id, merchant_id: merchantId });
  }
}
