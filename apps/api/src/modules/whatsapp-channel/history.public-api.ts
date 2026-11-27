import { Inject, Injectable, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";

/** Channel-owned persisted sessions; checkout separately proves the phone binding. */
@Injectable()
export class WhatsAppRelationshipHistoryReader {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: PrismaClient) {}
  page(
    merchantId: string,
    snapshotAt: string,
    after: string | null,
    limit: number
  ) {
    return this.db.whatsAppSession.findMany({
      where: {
        merchantId,
        createdAt: { lte: new Date(snapshotAt) },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit,
      select: {
        id: true,
        checkoutSessionId: true,
        buyerPhone: true,
        deviceId: true,
        createdAt: true,
        lastActivityAt: true,
        conversationState: true,
      },
    });
  }
  forCheckout(merchantId: string, sessionId: string) {
    return this.db.whatsAppSession.findFirst({
      where: { merchantId, checkoutSessionId: sessionId },
      select: { buyerPhone: true, deviceId: true },
    });
  }
}
@Module({
  providers: [WhatsAppRelationshipHistoryReader],
  exports: [WhatsAppRelationshipHistoryReader],
})
export class WhatsAppRelationshipHistoryModule {}
