import { Inject, Injectable, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
@Injectable()
export class CheckoutRelationshipReader {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: PrismaClient) {}
  async session(merchantId: string, key: string) {
    const session = await this.db.checkoutSession.findFirst({
      where: { merchantId, OR: [{ sessionId: key }, { conversationId: key }, {cart:{path:["cart_ref"],equals:key}}] },
      select: {
        sessionId: true,
        conversationId: true,
        globalUserId: true,
        customer: true,
        cart: true,
      },
    });
    if (!session) return null;
    const customer =
      typeof session.customer === "object" &&
      session.customer !== null &&
      !Array.isArray(session.customer)
        ? session.customer
        : null;
    const cart =
      typeof session.cart === "object" &&
      session.cart !== null &&
      !Array.isArray(session.cart)
        ? session.cart
        : null;
    const phone =
      customer?.phone_verified === true && typeof customer.phone === "string"
        ? customer.phone
        : null;
    return {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      globalUserId: session.globalUserId,
      verifiedPhone: phone,
      shopping: Array.isArray(cart?.items) && cart.items.length > 0,
    };
  }
  async order(merchantId: string, sessionId: string) {
    const order = await this.db.completedOrder.findFirst({
      where: { merchantId, sessionId, status: "approved", currency: "BRL" },
      orderBy: { completedAt: "desc" },
      select: { id: true, orderTotal: true, completedAt: true },
    });
    if (!order) return null;
    const amountCents = order.orderTotal.mul(100).toDecimalPlaces(0).toNumber();
    return Number.isSafeInteger(amountCents) && amountCents >= 0
      ? {
          id: order.id,
          amountCents,
          occurredAt: order.completedAt.toISOString(),
        }
      : null;
  }
  historySession(merchantId: string, sessionId: string) {
    return this.db.checkoutSession.findFirst({
      where: { merchantId, sessionId },
      select: {
        sessionId: true,
        globalUserId: true,
        customer: true,
        chatHistory: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
  async historyOrdersPage(
    merchantId: string,
    snapshotAt: string,
    after: string | null,
    limit: number
  ) {
    const rows = await this.db.completedOrder.findMany({
      where: {
        merchantId,
        status: "approved",
        currency: "BRL",
        completedAt: { lte: new Date(snapshotAt) },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit,
      select: {
        id: true,
        sessionId: true,
        orderTotal: true,
        completedAt: true,
        session: {
          select: { globalUserId: true, customer: true, createdAt: true },
        },
      },
    });
    return rows.map((row) => ({
      ...row,
      amountCents: row.orderTotal.mul(100).toDecimalPlaces(0).toNumber(),
    }));
  }
  async hasAccountPurchase(merchantId: string, accountId: string) {
    return Boolean(
      await this.db.completedOrder.findFirst({
        where: {
          merchantId,
          status: "approved",
          session: { globalUserId: accountId },
        },
        select: { id: true },
      })
    );
  }
}
@Module({
  providers: [CheckoutRelationshipReader],
  exports: [CheckoutRelationshipReader],
})
export class CheckoutRelationshipModule {}
