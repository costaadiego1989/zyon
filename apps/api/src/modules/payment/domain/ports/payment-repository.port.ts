import type { PaymentIntentEntity } from "../payment-intent.entity.js";

export type SavePaymentIntentInput = {
  intent: PaymentIntentEntity;
};

export interface PaymentRepository {
  saveIntent(input: SavePaymentIntentInput): Promise<void>;
  getByIdempotency(
    merchantId: string,
    sessionId: string,
    idempotencyKey: string
  ): Promise<PaymentIntentEntity | null>;
  getByProviderPaymentId(
    merchantId: string,
    providerPaymentId: string
  ): Promise<PaymentIntentEntity | null>;
}
