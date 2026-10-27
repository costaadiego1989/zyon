import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export type FunnelStage = 'conversation_started' | 'cart_viewed' | 'cart_item_added' | 'checkout_started' | 'checkout_completed';

export interface RecordFunnelEventInput {
  merchantId: string;
  sessionId: string;
  stage: FunnelStage;
  metadata?: {
    cartItemsAdded?: number;
    timeFromStart?: number; // seconds from session start
  };
}

@Injectable()
export class RecordFunnelEventUseCase {
  private readonly logger = new Logger(RecordFunnelEventUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: RecordFunnelEventInput): Promise<void> {
    const { merchantId, sessionId, stage, metadata } = input;

    // Find the checkout session to get the variant ID
    const session = await this.prisma.checkoutSession.findFirst({
      where: {
        merchantId,
        sessionId,
      },
    });

    if (!session) {
      this.logger.debug(`Session not found: ${merchantId}/${sessionId}`);
      return;
    }

    if (!session.promptVariantId) {
      this.logger.debug(`Session has no promptVariantId: ${sessionId} — skipping funnel tracking`);
      return;
    }

    try {
      const createData = this.buildCreateData(session.promptVariantId, sessionId, stage, metadata);
      const updateData = this.buildUpdateData(stage, metadata);

      await (this.prisma as any).promptVariantResult.upsert({
        where: {
          variantId_sessionId: {
            variantId: session.promptVariantId,
            sessionId,
          },
        },
        create: createData,
        update: updateData,
      });

      this.logger.log(
        `Recorded funnel event: variant=${session.promptVariantId} session=${sessionId} stage=${stage}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to record funnel event: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Non-critical: don't throw — funnel tracking failure should not break the main flow
    }
  }

  private buildCreateData(
    variantId: string,
    sessionId: string,
    stage: FunnelStage,
    metadata?: RecordFunnelEventInput['metadata'],
  ) {
    const base: Record<string, unknown> = {
      variantId,
      sessionId,
      converted: false,
      conversationStarted: true,
    };

    switch (stage) {
      case 'cart_viewed':
        base.cartViewed = true;
        if (metadata?.timeFromStart) base.timeToCart = metadata.timeFromStart;
        break;
      case 'cart_item_added':
        base.cartViewed = true;
        base.cartItemsAdded = metadata?.cartItemsAdded ?? 1;
        if (metadata?.timeFromStart) base.timeToCart = metadata.timeFromStart;
        break;
      case 'checkout_started':
        base.checkoutStarted = true;
        if (metadata?.timeFromStart) base.timeToCheckout = metadata.timeFromStart;
        break;
      case 'checkout_completed':
        base.checkoutCompleted = true;
        if (metadata?.timeFromStart) base.timeToConversion = metadata.timeFromStart;
        break;
    }
    return base;
  }

  private buildUpdateData(
    stage: FunnelStage,
    metadata?: RecordFunnelEventInput['metadata'],
  ) {
    const update: Record<string, unknown> = {};

    switch (stage) {
      case 'conversation_started':
        update.conversationStarted = true;
        break;
      case 'cart_viewed':
        update.cartViewed = true;
        if (metadata?.timeFromStart) update.timeToCart = metadata.timeFromStart;
        break;
      case 'cart_item_added':
        update.cartViewed = true;
        update.cartItemsAdded = { increment: metadata?.cartItemsAdded ?? 1 };
        if (metadata?.timeFromStart) update.timeToCart = metadata.timeFromStart;
        break;
      case 'checkout_started':
        update.checkoutStarted = true;
        if (metadata?.timeFromStart) update.timeToCheckout = metadata.timeFromStart;
        break;
      case 'checkout_completed':
        update.checkoutCompleted = true;
        if (metadata?.timeFromStart) update.timeToConversion = metadata.timeFromStart;
        break;
    }
    return update;
  }
}
