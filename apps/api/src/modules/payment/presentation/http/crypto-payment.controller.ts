import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";
import {
  ConfirmCryptoPaymentUseCase,
  type ConfirmCryptoPaymentRequest
} from "../../application/confirm-crypto-payment.use-case.js";
import { BullMqCryptoVerifyQueue } from "../../infrastructure/bullmq-crypto-verify.queue.js";

@Controller()
export class CryptoPaymentController {
  constructor(
    private readonly confirmCrypto: ConfirmCryptoPaymentUseCase,
    private readonly verifyQueue: BullMqCryptoVerifyQueue
  ) {}

  @NonProductionRoute()
  @HttpCode(202)
  @Post("payment/intents/:intentId/crypto/confirm")
  async confirmLegacy(
    @Param("intentId") intentId: string,
    @Body() body: Omit<ConfirmCryptoPaymentRequest, "intent_id">
  ) {
    const request: ConfirmCryptoPaymentRequest = { ...body, intent_id: intentId };
    // Enqueue for async verification with retry/backoff. Falls back to sync
    // verify when Redis is unavailable (dev/CI) so behavior is unchanged there.
    let enqueued = false;
    try {
      enqueued = await this.verifyQueue.enqueue(request);
    } catch (err) {
      // Enqueue failure must not 500 the buyer — fall back to synchronous verify.
      // eslint-disable-next-line no-console
      console.error("[CRYPTO-CONFIRM] enqueue failed, falling back to sync:", err);
    }
    if (enqueued) {
      return { status: "pending_verification", intent_id: intentId };
    }
    return this.confirmCrypto.execute(request);
  }
}
