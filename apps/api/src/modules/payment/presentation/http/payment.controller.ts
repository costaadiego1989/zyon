import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CreatePaymentIntentUseCase, type CreatePaymentIntentRequest } from "../../application/create-payment-intent.use-case.js";
import { GetPaymentIntentStatusUseCase } from "../../application/get-payment-intent-status.use-case.js";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";

@NonProductionRoute()
@Controller()
export class PaymentHttpController {
  constructor(
    private readonly createPaymentIntent: CreatePaymentIntentUseCase,
    private readonly getPaymentIntentStatus: GetPaymentIntentStatusUseCase
  ) {}

  @Post("payment/intents")
  createIntent(@Body() body: CreatePaymentIntentRequest) {
    return this.createPaymentIntent.execute(body);
  }

  @Get("payment/intents/:intentId/status")
  status(
    @Param("intentId") intentId: string,
    @Query("merchant_id") merchantId: string,
    @Query("session_id") sessionId: string
  ) {
    return this.getPaymentIntentStatus.execute({
      merchant_id: merchantId ?? "",
      session_id: sessionId ?? "",
      intent_id: intentId
    });
  }
}
