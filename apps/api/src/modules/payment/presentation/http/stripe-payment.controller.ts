import { Body, Controller, Param, Post } from "@nestjs/common";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";
import {
  ConfirmStripePaymentUseCase,
  type ConfirmStripePaymentRequest
} from "../../application/confirm-stripe-payment.use-case.js";

@Controller()
export class StripePaymentController {
  constructor(private readonly confirmStripe: ConfirmStripePaymentUseCase) {}

  @NonProductionRoute()
  @Post("payment/intents/:intentId/stripe/confirm")
  confirmLegacy(
    @Param("intentId") intentId: string,
    @Body() body: Omit<ConfirmStripePaymentRequest, "intent_id" | "merchant_id"> & { merchant_id: string }
  ) {
    return this.confirmStripe.execute({ ...body, intent_id: intentId });
  }
}
