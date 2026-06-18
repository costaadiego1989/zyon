import type { DomainEventEnvelope } from "@aacp/shared-types";
import type { PaymentIntentEntity } from "../payment-intent.entity.js";

export const PAYMENT_REPOSITORY = Symbol("PAYMENT_REPOSITORY");

export type SavePaymentIntentInput = {
  intent: PaymentIntentEntity;
};

export type PaymentProviderName = "asaas" | "stripe";

/** Identifies a provider webhook event for idempotent processing, scoped by tenant. */
export type ProviderEventKey = {
  provider: PaymentProviderName;
  /** Tenant boundary. `null` only when the intent (and thus merchant) is unknown. */
  merchantId: string | null;
  eventId: string;
};

export type StalePendingQuery = {
  /** Only intents not updated since this instant are candidates for reconciliation. */
  olderThan: Date;
  limit: number;
};

/** Global uniqueness key for an on-chain settlement, scoped by tenant + intent. */
export type CryptoTransferKey = {
  chain: string;
  txHash: string;
  merchantId: string;
  intentId: string;
};

export interface PaymentRepository {
  saveIntent(input: SavePaymentIntentInput): Promise<void>;
  /**
   * Persists the intent and appends the domain event atomically. A partial
   * provider failure must never leave the intent saved without its event, nor
   * the event emitted without the intent.
   */
  saveIntentWithOutbox(input: SavePaymentIntentInput, event: DomainEventEnvelope): Promise<void>;
  getByIdempotency(
    merchantId: string,
    sessionId: string,
    idempotencyKey: string
  ): Promise<PaymentIntentEntity | null>;
  getByProviderPaymentId(
    merchantId: string,
    providerPaymentId: string
  ): Promise<PaymentIntentEntity | null>;
  /**
   * Lookup do intent escopado pelo tenant. O `merchantId` é obrigatório e parte
   * do filtro de persistência — o boundary de tenant mora na porta, não em
   * pós-checagens por call site (ADR 0001 #3, ADR 0005).
   */
  getIntentById(merchantId: string, intentBusinessId: string): Promise<PaymentIntentEntity | null>;
  /**
   * Resolve o tenant a partir do `externalReference` (`pay_int_*`) quando o
   * merchant ainda é desconhecido (caminho de webhook). Devolve apenas
   * `id + merchantId` para forçar o re-fetch escopado via `getIntentById`,
   * nunca o snapshot completo (ADR 0001 #3).
   */
  getIntentByExternalReference(
    externalReference: string
  ): Promise<{ id: string; merchantId: string } | null>;
  /** Open intents (pending/requires_action) eligible for authoritative-state reconciliation. */
  listStalePending(query: StalePendingQuery): Promise<PaymentIntentEntity[]>;
  hasProcessedProviderEvent(key: ProviderEventKey): Promise<boolean>;
  /**
   * Portão atômico de idempotência: INSERT do marcador, `true` se gravou,
   * `false` se já existia (conflito de unicidade). Deve rodar ANTES do efeito
   * colateral, na mesma transação que muda o estado (ADR 0001 #1).
   */
  recordProcessedProviderEvent(key: ProviderEventKey): Promise<boolean>;
  /**
   * Remove o marcador de evento processado. Usado apenas para compensar uma
   * falha de dispatch após o gate ter reservado o marcador, preservando o
   * retry do provedor em vez de envenenar o evento (ADR 0001 #1).
   */
  deleteProcessedProviderEvent(key: ProviderEventKey): Promise<void>;
  /**
   * Portão de unicidade global de settlement cripto: INSERT de `(chain, txHash)`,
   * `true` se reservou para este intent, `false` se a tx já foi consumida (por
   * este ou outro intent). Deve rodar ANTES de `markApproved` para barrar replay
   * e reuso cross-intent de um mesmo `txHash` (ADR 0001 #2).
   */
  recordCryptoTransfer(key: CryptoTransferKey): Promise<boolean>;
  /** Compensa a reserva de `(chain, txHash)` se a aprovação não concluir. */
  deleteCryptoTransfer(key: Pick<CryptoTransferKey, "chain" | "txHash">): Promise<void>;
}
