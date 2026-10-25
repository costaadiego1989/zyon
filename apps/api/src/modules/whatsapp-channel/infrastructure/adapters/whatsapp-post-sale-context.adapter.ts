import { Injectable, Inject, Logger } from "@nestjs/common";
import type {
  WhatsAppPostSaleContextPort,
  PostSaleContext,
} from "../../domain/ports/whatsapp-post-sale-context.port.js";
import {
  WHATSAPP_SESSION_REPOSITORY,
  type WhatsAppSessionRepository,
} from "../../domain/ports/whatsapp-session-repository.port.js";

/**
 * Bridges post-sale → whatsapp-channel: marks a WhatsApp session as
 * "awaiting_nps" / "awaiting_review" so the incoming message handler
 * can capture the buyer's reply.
 *
 * Creates a session if none exists for the buyer (proactive outbound).
 */
@Injectable()
export class WhatsAppPostSaleContextAdapter implements WhatsAppPostSaleContextPort {
  private readonly logger = new Logger(WhatsAppPostSaleContextAdapter.name);

  constructor(
    @Inject(WHATSAPP_SESSION_REPOSITORY)
    private readonly sessionRepo: WhatsAppSessionRepository,
  ) {}

  async setPostSaleContext(
    merchantId: string,
    buyerPhone: string,
    context: PostSaleContext,
  ): Promise<void> {
    let session = await this.sessionRepo.findActiveByPhone(merchantId, buyerPhone);

    if (!session) {
      // Create a lightweight session so the reply handler can find it when
      // the buyer responds to the proactive post-sale message.
      session = await this.sessionRepo.create({
        merchantId,
        buyerPhone,
        deviceId: "post-sale-outbound",
        currentOptions: [],
        previousOptions: [],
        currentPage: 0,
        lastActivityAt: new Date(),
        status: "active",
      });
      this.logger.log(`Created WA session for post-sale context: ${buyerPhone}`);
    }

    await this.sessionRepo.setPostSaleContext(session.id, {
      stage: context.stage,
      orderId: context.orderId,
      productId: context.productId,
      buyerId: context.buyerId,
      askedAt: context.askedAt,
    });
  }

  async clearPostSaleContext(merchantId: string, buyerPhone: string): Promise<void> {
    const session = await this.sessionRepo.findActiveByPhone(merchantId, buyerPhone);
    if (!session) return;
    await this.sessionRepo.clearPostSaleContext(session.id);
  }
}
