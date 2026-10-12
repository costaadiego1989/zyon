import { Module } from "@nestjs/common";
import { CouponsExecutionModule } from "./coupons-execution.module.js";
import type { PrismaClient } from "@prisma/client";
import { EmbedModule } from "../embed/embed.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { COUPON_REDEMPTION_REPOSITORY } from "./domain/ports/coupon-redemption-repository.port.js";
import { PrismaCouponRedemptionRepository } from "./infrastructure/repositories/prisma-coupon-redemption.repository.js";
import { CreateCouponUseCase } from "./application/use-cases/create-coupon.use-case.js";
import { ArchiveCouponUseCase } from "./application/use-cases/archive-coupon.use-case.js";
import { ToggleCouponActiveUseCase } from "./application/use-cases/toggle-coupon-active.use-case.js";
import { RedeemCouponUseCase } from "./application/use-cases/redeem-coupon.use-case.js";
import { CouponsOnOrderCompletedHandler } from "./infrastructure/event-handlers/on-order-completed.handler.js";
import { MerchantCouponsController } from "./presentation/http/merchant-coupons.controller.js";
import { WidgetCouponsController } from "./presentation/http/widget-coupons.controller.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";

@Module({
  // AuthModule needed for AuthGuard in MerchantCouponsController (P3 fix)
  imports: [EmbedModule, CheckoutModule, MerchantModule, AuthModule, CouponsExecutionModule],
  controllers: [MerchantCouponsController, WidgetCouponsController],
  providers: [
    {
      provide: COUPON_REDEMPTION_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaCouponRedemptionRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    CreateCouponUseCase,
    ArchiveCouponUseCase,
    ToggleCouponActiveUseCase,
    RedeemCouponUseCase,
    CouponsOnOrderCompletedHandler,
    BillingPlanMeteringService,
    PlanLimitGuard
  ],
  exports: [
    CouponsExecutionModule,
    CreateCouponUseCase,
    ArchiveCouponUseCase,
    RedeemCouponUseCase,
  ]
})
export class CouponsModule {}

