import { Injectable, Logger, Inject } from "@nestjs/common";
import {
  NPS_REPOSITORY,
  type NpsRepositoryPort,
} from "../../domain/ports/nps-repository.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";

export interface SubmitNpsInput {
  merchantId: string;
  buyerId: string;
  orderId?: string;
  score: number;
  feedback?: string;
}

@Injectable()
export class SubmitNpsUseCase {
  private readonly logger = new Logger(SubmitNpsUseCase.name);

  constructor(
    @Inject(NPS_REPOSITORY)
    private readonly nps: NpsRepositoryPort,
    @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus: DomainEventBus
  ) {}

  async execute(input: SubmitNpsInput) {
    // Validate score
    if (input.score < 0 || input.score > 10 || !Number.isInteger(input.score)) {
      throw new Error("NPS score must be an integer between 0 and 10");
    }

    // Classify
    const classification = this.classify(input.score);

    const response = await this.nps.create({
      merchantId: input.merchantId,
      buyerId: input.buyerId,
      orderId: input.orderId,
      score: input.score,
      feedback: input.feedback,
    });

    // Publish event
    await this.eventBus.publish({
      eventType: "post_sale:nps_submitted",
      merchantId: input.merchantId,
      payload: {
        type: "post_sale:nps_submitted",
        merchantId: input.merchantId,
        npsId: response.id,
        buyerId: input.buyerId,
        score: input.score,
        classification,
      },
    });

    this.logger.log(
      `NPS response submitted`,
      {
        npsId: response.id,
        buyerId: input.buyerId,
        score: input.score,
        classification,
        merchantId: input.merchantId,
      }
    );

    return {
      npsId: response.id,
      classification,
    };
  }

  private classify(score: number): "promoter" | "passive" | "detractor" {
    if (score >= 9) return "promoter";
    if (score >= 7) return "passive";
    return "detractor";
  }
}
