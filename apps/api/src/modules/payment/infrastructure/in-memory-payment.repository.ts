import { Injectable, Optional, Inject } from "@nestjs/common";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import type {
  CryptoTransferKey,
  PaymentRepository,
  ProviderEventKey,
  SavePaymentIntentInput,
  StalePendingQuery
} from "../domain/ports/payment-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";

function trim(s: string): string {
  return s.trim();
}

function keyIdempotency(merchantId: string, sessionId: string, idempotencyKey: string): string {
  return `${trim(merchantId)}::${trim(sessionId)}::${trim(idempotencyKey)}`;
}

function keyProvider(merchantId: string, providerPaymentId: string): string {
  return `${trim(merchantId)}::${trim(providerPaymentId)}`;
}

function keyEvent(key: ProviderEventKey): string {
  return `${key.provider}::${key.merchantId ?? ""}::${trim(key.eventId)}`;
}

function keyCryptoTransfer(chain: string, txHash: string): string {
  return `${trim(chain).toLowerCase()}::${trim(txHash).toLowerCase()}`;
}

@Injectable()
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly byIdempotency = new Map<string, PaymentIntentEntity>();
  private readonly byProvider = new Map<string, PaymentIntentEntity>();
  private readonly byIntentId = new Map<string, PaymentIntentEntity>();
  private readonly processedEvents = new Set<string>();
  private readonly cryptoTransfers = new Map<string, string>();
  readonly capturedEvents: DomainEventEnvelope[] = [];

  constructor(@Optional() @Inject(OUTBOX_REPOSITORY) private readonly outbox?: OutboxRepository) {}

  async saveIntentWithOutbox(input: SavePaymentIntentInput, event: DomainEventEnvelope): Promise<void> {
    await this.saveIntent(input);
    if (this.outbox) {
      await this.outbox.appendOutbox(event);
    } else {
      this.capturedEvents.push(event);
    }
  }

  async listStalePending(query: StalePendingQuery): Promise<PaymentIntentEntity[]> {
    const out: PaymentIntentEntity[] = [];
    for (const entity of this.byIntentId.values()) {
      const snap = entity.snapshot();
      if (snap.status !== "pending" && snap.status !== "requires_action") continue;
      out.push(entity);
      if (out.length >= query.limit) break;
    }
    return out;
  }

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

  async getIntentById(merchantId: string, intentBusinessId: string): Promise<PaymentIntentEntity | null> {
    const entity = this.byIntentId.get(trim(intentBusinessId)) ?? null;
    if (!entity || entity.snapshot().merchantId !== trim(merchantId)) return null;
    return entity;
  }

  async getIntentByExternalReference(
    externalReference: string
  ): Promise<{ id: string; merchantId: string } | null> {
    const entity = this.byIntentId.get(trim(externalReference)) ?? null;
    if (!entity) return null;
    const snap = entity.snapshot();
    return { id: snap.id, merchantId: snap.merchantId };
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

  async hasProcessedProviderEvent(key: ProviderEventKey): Promise<boolean> {
    return this.processedEvents.has(keyEvent(key));
  }

  async recordProcessedProviderEvent(key: ProviderEventKey): Promise<boolean> {
    const k = keyEvent(key);
    if (this.processedEvents.has(k)) return false;
    this.processedEvents.add(k);
    return true;
  }

  async deleteProcessedProviderEvent(key: ProviderEventKey): Promise<void> {
    this.processedEvents.delete(keyEvent(key));
  }

  async recordCryptoTransfer(key: CryptoTransferKey): Promise<boolean> {
    const k = keyCryptoTransfer(key.chain, key.txHash);
    if (this.cryptoTransfers.has(k)) return false;
    this.cryptoTransfers.set(k, `${trim(key.merchantId)}::${trim(key.intentId)}`);
    return true;
  }

  async deleteCryptoTransfer(key: Pick<CryptoTransferKey, "chain" | "txHash">): Promise<void> {
    this.cryptoTransfers.delete(keyCryptoTransfer(key.chain, key.txHash));
  }

  async reapExpiredCryptoReservations(): Promise<number> {
    // In-memory implementation: no-op (in-memory doesn't track expires_at)
    return 0;
  }

  async listByMerchantId(
    merchantId: string,
    statusPrefix?: string,
  ): Promise<PaymentIntentEntity[]> {
    return [...this.byIntentId.values()].filter((i: PaymentIntentEntity) => {
      const snap = i.snapshot();
      if (snap.merchantId !== merchantId) return false;
      if (statusPrefix && !snap.status.startsWith(statusPrefix)) return false;
      return true;
    });
  }
}
