import { Injectable } from "@nestjs/common";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import type { PaymentRepository, SavePaymentIntentInput } from "../domain/ports/payment-repository.port.js";

function trim(s: string): string {
  return s.trim();
}

function keyIdempotency(merchantId: string, sessionId: string, idempotencyKey: string): string {
  return `${trim(merchantId)}::${trim(sessionId)}::${trim(idempotencyKey)}`;
}

function keyProvider(merchantId: string, providerPaymentId: string): string {
  return `${trim(merchantId)}::${trim(providerPaymentId)}`;
}

@Injectable()
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly byIdempotency = new Map<string, PaymentIntentEntity>();
  private readonly byProvider = new Map<string, PaymentIntentEntity>();

  async saveIntent(input: SavePaymentIntentInput): Promise<void> {
    const snap = input.intent.snapshot();
    const ik = keyIdempotency(snap.merchantId, snap.sessionId, snap.idempotencyKey);
    const cloned = PaymentIntentEntity.rehydrate(snap);
    this.byIdempotency.set(ik, cloned);
    if (snap.providerPaymentId) {
      const pk = keyProvider(snap.merchantId, snap.providerPaymentId);
      this.byProvider.set(pk, cloned);
    }
  }

  async getByIdempotency(
    merchantId: string,
    sessionId: string,
    idempotencyKey: string
  ): Promise<PaymentIntentEntity | null> {
    return this.byIdempotency.get(keyIdempotency(merchantId, sessionId, idempotencyKey)) ?? null;
  }

  async getByProviderPaymentId(
    merchantId: string,
    providerPaymentId: string
  ): Promise<PaymentIntentEntity | null> {
    return this.byProvider.get(keyProvider(merchantId, providerPaymentId)) ?? null;
  }
}
