import { Body, Controller, Post } from "@nestjs/common";
import { CreatePaymentIntentUseCase, type CreatePaymentIntentRequest } from "../../application/create-payment-intent.use-case.js";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";

@NonProductionRoute()
@Controller()
export class PaymentHttpController {
  constructor(private readonly createPaymentIntent: CreatePaymentIntentUseCase) {}

  @Post("payment/intents")
  createIntent(@Body() body: CreatePaymentIntentRequest) {
    return this.createPaymentIntent.execute(body);
  }
}
