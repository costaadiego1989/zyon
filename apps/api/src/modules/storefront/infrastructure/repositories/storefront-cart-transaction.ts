import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";

export function cartTotal(cart: StorefrontCart): number {
  const total = cart.items.reduce((sum, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 99 ||
        !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0) throw new BadRequestException("cart_line_invalid");
    return sum + line.unitPriceCents * line.quantity;
  }, 0);
  if (!Number.isSafeInteger(total) || total > 2_147_483_647) throw new BadRequestException("cart_total_invalid");
  return total;
}

// All cart writers share this lock, including ordinary host-product mutations.
export async function withStorefrontCart<T>(prisma: PrismaClient, merchantId: string, sessionId: string,
  work: (tx: Prisma.TransactionClient, cart: StorefrontCart) => Promise<T>): Promise<{ result: T; cart: StorefrontCart }> {
  if (!merchantId?.trim() || !sessionId?.trim()) throw new BadRequestException("cart_scope_required");
  return prisma.$transaction(async tx => {
    const key = JSON.stringify(["storefront-cart", merchantId, sessionId]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const row = await tx.storefrontCart.upsert({ where: { merchantId_sessionId: { merchantId, sessionId } },
      create: { merchantId, sessionId, expiresAt: new Date(Date.now() + 72 * 3600_000) }, update: {} });
    const cart = { ...row, items: row.items as unknown as StorefrontCart["items"] };
    if (!Array.isArray(cart.items)) throw new ConflictException("cart_items_invalid");
    const result = await work(tx, cart);
    cart.total = cartTotal(cart);
    const saved = await tx.storefrontCart.update({ where: { id: cart.id }, data: {
      items: cart.items as unknown as Prisma.InputJsonValue, total: cart.total, discount: cart.discount,
      couponCode: cart.couponCode, freeShipping: cart.freeShipping, expiresAt: new Date(Date.now() + 72 * 3600_000),
    } });
    return { result, cart: { ...saved, items: saved.items as unknown as StorefrontCart["items"] } };
  }, { maxWait: 10_000, timeout: 15_000 });
}
