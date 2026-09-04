import { Injectable, Logger } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
  type ScheduledMessage,
} from "../../domain/ports/scheduled-message-repository.port.js";
import { PostSaleConfigService } from "../services/post-sale-config.service.js";

export interface SchedulePostDeliveryFlowInput {
  merchantId: string;
  orderId: string;
  buyerId: string;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerName?: string;
  productName?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SchedulePostDeliveryFlowUseCase {
  private readonly logger = new Logger(SchedulePostDeliveryFlowUseCase.name);

  constructor(
    @Inject(SCHEDULED_MESSAGE_REPOSITORY)
    private readonly messages: ScheduledMessageRepositoryPort,
    private readonly config: PostSaleConfigService
  ) {}

  async execute(input: SchedulePostDeliveryFlowInput): Promise<{ scheduled: number; skipped: string[] }> {
    const now = new Date();
    const cfg = await this.config.getConfig(input.merchantId);

    // Build the candidate flow, then gate each entry on the merchant's config.
    // Disabling a campaign in the dashboard now actually skips it here.
    const candidates: Array<{
      type: ScheduledMessage["type"];
      enabled: boolean;
      delayDays: number;
    }> = [
      { type: "follow_up", enabled: cfg.followUpEnabled, delayDays: 0 },
      { type: "review_request", enabled: cfg.reviewEnabled, delayDays: cfg.reviewDelayDays },
      { type: "cross_sell", enabled: cfg.crossSellEnabled, delayDays: cfg.crossSellDelayDays },
      { type: "nps", enabled: cfg.npsEnabled, delayDays: cfg.npsDelayDays },
    ];

    const channel: ScheduledMessage["channel"] = input.buyerPhone ? "whatsapp" : "email";
    let count = 0;
    const skipped: string[] = [];

    for (const candidate of candidates) {
      if (!candidate.enabled) {
        skipped.push(candidate.type);
        continue;
      }
      try {
        await this.messages.create({
          merchantId: input.merchantId,
          orderId: input.orderId,
          buyerId: input.buyerId,
          type: candidate.type,
          channel,
          sendAt: new Date(now.getTime() + candidate.delayDays * DAY_MS),
          buyerPhone: input.buyerPhone,
          buyerEmail: input.buyerEmail,
          buyerName: input.buyerName,
          productName: input.productName,
        });
        count++;
      } catch (err) {
        this.logger.error(`Failed to schedule ${candidate.type} message`, {
          merchantId: input.merchantId,
          orderId: input.orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger.log(`Scheduled ${count} post-delivery messages`, {
      merchantId: input.merchantId,
      orderId: input.orderId,
      buyerId: input.buyerId,
      skipped,
    });

    return { scheduled: count, skipped };
  }
}
