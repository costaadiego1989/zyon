import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PostSaleReplyHandlerPort } from "../../domain/ports/post-sale-reply-handler.port.js";
import type { SubmitNpsUseCase } from "../../application/use-cases/submit-nps.use-case.js";
import type { SubmitReviewUseCase } from "../../application/use-cases/submit-review.use-case.js";

/**
 * Adapter that bridges WhatsApp reply capture → post-sale NPS + product reviews.
 *
 * Key behavior: NPS also creates a product review for EVERY product in the order
 * (since the customer is rating the overall experience, all products benefit).
 * If the order has 3 items, 3 reviews are created with the same score/text.
 */
@Injectable()
export class PostSaleReplyHandlerAdapter implements PostSaleReplyHandlerPort {
  private readonly logger = new Logger(PostSaleReplyHandlerAdapter.name);

  constructor(
    private readonly submitNps: SubmitNpsUseCase,
    private readonly submitReview: SubmitReviewUseCase,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  async handleNpsReply(input: {
    merchantId: string;
    buyerId: string;
    orderId?: string;
    score: number;
    feedback?: string;
  }): Promise<void> {
    // 1. Submit NPS score
    await this.submitNps.execute({
      merchantId: input.merchantId,
      buyerId: input.buyerId,
      orderId: input.orderId,
      score: input.score,
      feedback: input.feedback,
    });

    // 2. Also create product reviews for all products in this order.
    // Maps NPS (0-10) to review rating (1-5): score/2, min 1, max 5.
    const rating = Math.max(1, Math.min(5, Math.round(input.score / 2)));
    await this.createReviewsForOrderProducts(input.merchantId, input.buyerId, input.orderId, rating, input.feedback);
  }

  async handleReviewReply(input: {
    merchantId: string;
    buyerId: string;
    productId: string;
    orderId?: string;
    text: string;
    rating?: number;
  }): Promise<void> {
    const rating = input.rating ?? 4;

    // If we have an orderId, create reviews for ALL products in the order (not just one).
    if (input.orderId && this.prisma) {
      await this.createReviewsForOrderProducts(input.merchantId, input.buyerId, input.orderId, rating, input.text);
    } else {
      // Fallback: single product review
      await this.submitReview.execute({
        merchantId: input.merchantId,
        buyerId: input.buyerId,
        productId: input.productId,
        orderId: input.orderId,
        rating,
        text: input.text,
      });
    }
  }

  /**
   * Finds all products from a completed order and creates a review for each one.
   * Uses the buyer's NPS score (mapped to 1-5) or explicit rating.
   */
  private async createReviewsForOrderProducts(
    merchantId: string,
    buyerId: string,
    orderId: string | undefined,
    rating: number,
    text: string | undefined,
  ): Promise<void> {
    if (!orderId || !this.prisma) return;

    try {
      // Find the order's session to get cart items (products).
      // CompletedOrders link back to CheckoutSessions which have the cart.
      const order = await (this.prisma as any).completedOrder.findFirst({
        where: { externalOrderId: orderId, merchantId },
        include: { session: true },
      });

      if (!order?.session?.cart) {
        this.logger.debug(`No cart found for order ${orderId}; skipping bulk reviews`);
        return;
      }

      // Cart is JSON: { items: [{product_id, name, ...}] }
      const cart = typeof order.session.cart === "string" ? JSON.parse(order.session.cart) : order.session.cart;
      const items: Array<{ product_id?: string; productId?: string; sku?: string; name?: string }> = cart.items ?? [];

      if (items.length === 0) {
        this.logger.debug(`Order ${orderId} has no items in cart; skipping reviews`);
        return;
      }

      let created = 0;
      for (const item of items) {
        const productId = item.product_id || item.productId;
        if (!productId) continue;

        try {
          await this.submitReview.execute({
            merchantId,
            buyerId,
            productId,
            orderId,
            rating,
            text: text || undefined,
          });
          created++;
        } catch (err) {
          // May fail if review already exists for this product+buyer — skip
          this.logger.debug(`Review for product ${productId} skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      this.logger.log(`Created ${created} product reviews for order ${orderId} (${items.length} items, rating ${rating})`);
    } catch (err) {
      this.logger.error(`Failed to create bulk reviews for order ${orderId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
