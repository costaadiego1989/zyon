import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

/** The legacy single-tenant carrier POST flow has no per-origin durable journal. */
@Injectable()
export class MarketplaceLabelPurchaseGuard {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async assertOrdinaryOrder(input: { merchantId: string; externalOrderId: string }) {
    const order = await this.prisma.completedOrder.findFirst({ where: { merchantId: input.merchantId, externalOrderId: input.externalOrderId } });
    if (!order) throw new NotFoundException("completed_order_not_found");
    const funding = await this.prisma.marketplaceFundingPlan.findFirst({ where: {
      hostMerchantId: input.merchantId, OR: [{ providerPaymentId: input.externalOrderId },
        { payment: { merchantId: input.merchantId, sessionId: order.sessionId } }] } });
    const line = await this.prisma.crossStoreLineItem.findFirst({ where: { hostMerchantId: input.merchantId, orderId: input.externalOrderId } });
    const session = await this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: order.sessionId } },
      select: { cart: true } });
    const cart = session?.cart as { items?: Array<{ marketplace?: unknown }> } | null;
    if (funding || line || cart?.items?.some(item => item.marketplace)) {
      throw new ConflictException("marketplace_shipping_label_journal_required");
    }
  }
}
