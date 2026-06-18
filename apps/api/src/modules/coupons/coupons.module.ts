import { Module } from "@nestjs/common";
import { EmbedModule } from "../embed/embed.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { COUPON_REPOSITORY } from "./domain/ports/coupon-repository.port.js";
import { COUPON_REDEMPTION_REPOSITORY } from "./domain/ports/coupon-redemption-repository.port.js";
import { DISCOUNT_RULES_ENGINE } from "./domain/ports/discount-rules-engine.port.js";
import { InMemoryCouponRepository } from "./infrastructure/repositories/in-memory-coupon.repository.js";
import { InMemoryCouponRedemptionRepository } from "./infrastructure/repositories/in-memory-coupon-redemption.repository.js";
import { RulesEngineDiscountAdapter } from "./infrastructure/adapters/rules-engine-discount.adapter.js";
import { CreateCouponUseCase } from "./application/use-cases/create-coupon.use-case.js";
import { ArchiveCouponUseCase } from "./application/use-cases/archive-coupon.use-case.js";
import { ApplyCouponUseCase } from "./application/use-cases/apply-coupon.use-case.js";
import { RedeemCouponUseCase } from "./application/use-cases/redeem-coupon.use-case.js";
import { CouponsOnOrderCompletedHandler } from "./infrastructure/event-handlers/on-order-completed.handler.js";
import { MerchantCouponsController } from "./presentation/http/merchant-coupons.controller.js";
import { WidgetCouponsController } from "./presentation/http/widget-coupons.controller.js";

@Module({
  // AuthModule needed for AuthGuard in MerchantCouponsController (P3 fix)
  imports: [EmbedModule, CheckoutModule, MerchantModule, AuthModule],
  controllers: [MerchantCouponsController, WidgetCouponsController],
  providers: [
    InMemoryCouponRepository,
    InMemoryCouponRedemptionRepository,
    RulesEngineDiscountAdapter,
    { provide: COUPON_REPOSITORY, useExisting: InMemoryCouponRepository },
    { provide: COUPON_REDEMPTION_REPOSITORY, useExisting: InMemoryCouponRedemptionRepository },
    // P0 fix: wire rules-engine discount port to its adapter
    { provide: DISCOUNT_RULES_ENGINE, useExisting: RulesEngineDiscountAdapter },
    CreateCouponUseCase,
    ArchiveCouponUseCase,
    ApplyCouponUseCase,
    RedeemCouponUseCase,
    CouponsOnOrderCompletedHandler
  ],
  exports: [ApplyCouponUseCase, RedeemCouponUseCase]
})
export class CouponsModule {}

