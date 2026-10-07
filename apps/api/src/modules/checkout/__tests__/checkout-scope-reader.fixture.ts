import type { PrismaClient } from "@prisma/client";
import type { CheckoutSessionRepository } from "../domain/ports/checkout-session.repository.port.js";

/** Explicit persistence boundary for in-memory ordinary-checkout fixtures.
 * Marketplace tests supply their own persisted lines; production uses Prisma. */
export function checkoutScopeReader(repository?: Pick<CheckoutSessionRepository, "getSession">): PrismaClient {
  return {
    checkoutSession: { findUnique: async ({ where }: { where: { merchantId_sessionId: { merchantId: string; sessionId: string } } }) => {
      const scope = where.merchantId_sessionId;
      return await repository?.getSession(scope.merchantId, scope.sessionId) ?? null;
    } },
    crossStoreLineItem: { findFirst: async () => null },
    productVariant: { findMany: async () => [] },
  } as unknown as PrismaClient;
}
