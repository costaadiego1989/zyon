import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Common cart fence across storefront writers and checkout/coupon lifecycle.
 * Callers own the transaction and must keep checkout locks BEFORE this one. */
export async function lockStorefrontCart(tx: Prisma.TransactionClient, merchantId: string, sessionId: string): Promise<void> {
  if (!merchantId?.trim() || !sessionId?.trim()) throw new BadRequestException("cart_scope_required");
  const key = JSON.stringify(["storefront-cart", merchantId, sessionId]);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
