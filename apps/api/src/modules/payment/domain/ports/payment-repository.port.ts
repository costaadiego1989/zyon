import type { PaymentIntentEntity } from "../payment-intent.entity.js";

export const PAYMENT_REPOSITORY = Symbol("PAYMENT_REPOSITORY");

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
  /** Identificador de negócio `pay_int_*` (enviado a Asaas como `externalReference`). */
  getIntentById(intentBusinessId: string): Promise<PaymentIntentEntity | null>;
  hasProcessedProviderEvent(providerEventId: string): Promise<boolean>;
  recordProcessedProviderEvent(providerEventId: string): Promise<boolean>;
}
