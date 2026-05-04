/** Índice idempotente: uma ordem pendente por par (merchantId, checkout sessionId). */
export interface PendingCommerceOrderIndexPort {
  find(merchantId: string, sessionId: string): Promise<string | undefined>;
  remember(merchantId: string, sessionId: string, commerceOrderId: string): Promise<void>;
}

/** Token DI para o armazém do índice (tipicamente singleton in-memory até Prisma PAY). */
export const COMMERCE_PENDING_ORDER_INDEX = Symbol("COMMERCE_PENDING_ORDER_INDEX");
