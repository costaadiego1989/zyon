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
  private readonly byIntentId = new Map<string, PaymentIntentEntity>();
  private readonly processedEvents = new Set<string>();

  async saveIntent(input: SavePaymentIntentInput): Promise<void> {
    const snap = input.intent.snapshot();
    const ik = keyIdempotency(snap.merchantId, snap.sessionId, snap.idempotencyKey);
    const cloned = PaymentIntentEntity.rehydrate(snap);

    const staleKeys: string[] = [];
    for (const [providerKey, existing] of this.byProvider.entries()) {
      if (existing.snapshot().id === snap.id) staleKeys.push(providerKey);
    }
    for (const pk of staleKeys) this.byProvider.delete(pk);

    this.byIdempotency.set(ik, cloned);

    if (snap.providerPaymentId) {
      const pk = keyProvider(snap.merchantId, snap.providerPaymentId);
      this.byProvider.set(pk, cloned);
    }
    this.byIntentId.set(snap.id, cloned);
  }

  async getIntentById(intentBusinessId: string): Promise<PaymentIntentEntity | null> {
    return this.byIntentId.get(trim(intentBusinessId)) ?? null;
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

  async hasProcessedProviderEvent(providerEventId: string): Promise<boolean> {
    return this.processedEvents.has(providerEventId.trim());
  }

  async recordProcessedProviderEvent(providerEventId: string): Promise<boolean> {
    const id = providerEventId.trim();
    if (this.processedEvents.has(id)) return false;
    this.processedEvents.add(id);
    return true;
  }
}
