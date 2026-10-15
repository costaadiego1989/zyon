import { Module } from "@nestjs/common";
import Stripe from "stripe";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { readStripeConnection } from "../payment/infrastructure/stripe-env.js";
import { BILLING_PROMOTIONS_STRIPE, BillingPromotionsService } from "./billing-promotions.service.js";
import { BillingPromotionsController } from "./billing-promotions.controller.js";

@Module({
  imports: [PlatformControlModule], controllers: [BillingPromotionsController],
  providers: [BillingPromotionsService, { provide: BILLING_PROMOTIONS_STRIPE, useFactory: () => {
    const secret = readStripeConnection().secretKey;
    return secret ? new Stripe(secret, { timeout: 15000, maxNetworkRetries: 1 }) : null;
  } }],
})
export class BillingPromotionsModule {}
