import { Module } from "@nestjs/common";
import Stripe from "stripe";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { readStripeConnection } from "../payment/infrastructure/stripe-env.js";
import { BILLING_PROMOTIONS_STRIPE, BillingPromotionsService } from "./billing-promotions.service.js";
import { BillingPromotionsController } from "./billing-promotions.controller.js";
import { BillingPublicPromotionsController } from "./billing-public-promotions.controller.js";
import { BILLING_CHECKOUT_PROMOTION_PORT } from "../payment/domain/ports/payment-platform-provider.port.js";

@Module({
  imports: [PlatformControlModule], controllers: [BillingPromotionsController, BillingPublicPromotionsController],
  providers: [BillingPromotionsService, { provide: BILLING_CHECKOUT_PROMOTION_PORT, useExisting: BillingPromotionsService }, { provide: BILLING_PROMOTIONS_STRIPE, useFactory: () => {
    const secret = readStripeConnection().secretKey;
    return secret ? new Stripe(secret, { timeout: 15000, maxNetworkRetries: 1 }) : null;
  } }],
  exports: [BILLING_CHECKOUT_PROMOTION_PORT],
})
export class BillingPromotionsModule {}
