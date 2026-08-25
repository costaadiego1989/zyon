import { Injectable, Logger } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
} from "../../domain/ports/scheduled-message-repository.port.js";

export interface SchedulePostDeliveryFlowInput {
  merchantId: string;
  orderId: string;
  buyerId: string;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerName?: string;
  productName?: string;
}

@Injectable()
export class SchedulePostDeliveryFlowUseCase {
  private readonly logger = new Logger(SchedulePostDeliveryFlowUseCase.name);

  constructor(
    @Inject(SCHEDULED_MESSAGE_REPOSITORY)
    private readonly messages: ScheduledMessageRepositoryPort
  ) {}

  async execute(input: SchedulePostDeliveryFlowInput): Promise<{ scheduled: number }> {
    const now = new Date();

    // Create 4 scheduled messages: follow-up (D+0), review (D+3), cross-sell (D+5), nps (D+7)
    const schedules = [
      {
        type: "follow_up" as const,
        sendAt: now,
      },
      {
        type: "review_request" as const,
        sendAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      },
      {
        type: "cross_sell" as const,
        sendAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
      {
        type: "nps" as const,
        sendAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    ];

    let count = 0;
    for (const schedule of schedules) {
      try {
        await this.messages.create({
          merchantId: input.merchantId,
          orderId: input.orderId,
          buyerId: input.buyerId,
          type: schedule.type,
          channel: input.buyerPhone ? "whatsapp" : "email",
          sendAt: schedule.sendAt,
          buyerPhone: input.buyerPhone,
          buyerEmail: input.buyerEmail,
          buyerName: input.buyerName,
          productName: input.productName,
        });
        count++;
      } catch (err) {
        this.logger.error(
          `Failed to schedule ${schedule.type} message`,
          {
            merchantId: input.merchantId,
            orderId: input.orderId,
            error: err instanceof Error ? err.message : String(err),
          }
        );
      }
    }

    this.logger.log(
      `Scheduled ${count} post-delivery messages`,
      {
        merchantId: input.merchantId,
        orderId: input.orderId,
        buyerId: input.buyerId,
      }
    );

    return { scheduled: count };
  }
}
