import { Module } from "@nestjs/common";
import { EmbedModule } from "../embed/embed.module.js";
import { COUPON_REPOSITORY } from "./domain/ports/coupon-repository.port.js";
import { COUPON_REDEMPTION_REPOSITORY } from "./domain/ports/coupon-redemption-repository.port.js";
import { InMemoryCouponRepository } from "./infrastructure/repositories/in-memory-coupon.repository.js";
import { InMemoryCouponRedemptionRepository } from "./infrastructure/repositories/in-memory-coupon-redemption.repository.js";
import { CreateCouponUseCase } from "./application/use-cases/create-coupon.use-case.js";
import { ArchiveCouponUseCase } from "./application/use-cases/archive-coupon.use-case.js";
import { ApplyCouponUseCase } from "./application/use-cases/apply-coupon.use-case.js";
import { RedeemCouponUseCase } from "./application/use-cases/redeem-coupon.use-case.js";
import { CouponsOnOrderCompletedHandler } from "./infrastructure/event-handlers/on-order-completed.handler.js";
import { MerchantCouponsController } from "./presentation/http/merchant-coupons.controller.js";
import { WidgetCouponsController } from "./presentation/http/widget-coupons.controller.js";

@Module({
  imports: [EmbedModule],
  controllers: [MerchantCouponsController, WidgetCouponsController],
  providers: [
    InMemoryCouponRepository,
    InMemoryCouponRedemptionRepository,
    { provide: COUPON_REPOSITORY, useExisting: InMemoryCouponRepository },
    { provide: COUPON_REDEMPTION_REPOSITORY, useExisting: InMemoryCouponRedemptionRepository },
    CreateCouponUseCase,
    ArchiveCouponUseCase,
    ApplyCouponUseCase,
    RedeemCouponUseCase,
    CouponsOnOrderCompletedHandler
  ],
  exports: [ApplyCouponUseCase, RedeemCouponUseCase]
})
export class CouponsModule {}
