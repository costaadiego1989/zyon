import { Body, Controller, Param, Post } from "@nestjs/common";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";
import {
  ConfirmCryptoPaymentUseCase,
  type ConfirmCryptoPaymentRequest
} from "../../application/confirm-crypto-payment.use-case.js";

@Controller()
export class CryptoPaymentController {
  constructor(private readonly confirmCrypto: ConfirmCryptoPaymentUseCase) {}

  @NonProductionRoute()
  @Post("payment/intents/:intentId/crypto/confirm")
  confirmLegacy(
    @Param("intentId") intentId: string,
    @Body() body: Omit<ConfirmCryptoPaymentRequest, "intent_id">
  ) {
    return this.confirmCrypto.execute({ ...body, intent_id: intentId });
  }
}
