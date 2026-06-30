import type { DomainEventEnvelope } from "@zyon/shared-types";

/** Índice idempotente: uma ordem pendente por par (merchantId, checkout sessionId). */
export interface PendingCommerceOrderIndexPort {
  find(merchantId: string, sessionId: string): Promise<string | undefined>;
  /**
   * Persists the (merchant, session) → commerceOrderId mapping. When `event`
   * is provided, the durable repo appends it to the outbox in the SAME
   * transaction as the index row (aggregate write + outbox emit atomic).
   */
  remember(
    merchantId: string,
    sessionId: string,
    commerceOrderId: string,
    event?: DomainEventEnvelope
  ): Promise<void>;
}

/** Token DI para o armazém do índice (tipicamente singleton in-memory até Prisma PAY). */
export const COMMERCE_PENDING_ORDER_INDEX = Symbol("COMMERCE_PENDING_ORDER_INDEX");
