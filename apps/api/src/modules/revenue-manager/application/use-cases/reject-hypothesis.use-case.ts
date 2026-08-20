import { Inject, Injectable, Logger } from "@nestjs/common";
import { HYPOTHESIS_REPOSITORY_PORT, type HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import type { DomainEventEnvelope } from "@zyon/shared-types";

export interface RejectHypothesisInput {
  hypothesis_id: string;
  merchant_id: string;
  reason: string;
}

export interface RejectHypothesisOutput {
  hypothesis_id: string;
  status: string;
  rejection_reason: string;
}

@Injectable()
export class RejectHypothesisUseCase {
  private readonly logger = new Logger(RejectHypothesisUseCase.name);

  constructor(
    @Inject(HYPOTHESIS_REPOSITORY_PORT) private readonly hypothesisRepo: HypothesisRepositoryPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  async execute(input: RejectHypothesisInput): Promise<RejectHypothesisOutput> {
    const hypothesis = await this.hypothesisRepo.findById(input.hypothesis_id, input.merchant_id);
    if (!hypothesis) {
      throw new Error("HYPOTHESIS_NOT_FOUND");
    }

    const updated = hypothesis.reject(input.reason);
    await this.hypothesisRepo.save(updated);

    const event: DomainEventEnvelope = {
      event_id: `evt_${crypto.randomUUID()}`,
      event_type: "revenue_manager.hypothesis.rejected",
      schema_version: 1,
      merchant_id: input.merchant_id,
      occurred_at: new Date().toISOString(),
      correlation_id: `corr_${crypto.randomUUID()}`,
      causation_id: "revenue_manager.reject_hypothesis",
      producer: "revenue-manager",
      payload: {
        hypothesis_id: input.hypothesis_id,
        reason: input.reason,
      },
    };
    await this.outbox.appendOutbox(event);

    this.logger.log(`Hypothesis ${input.hypothesis_id} rejected: ${input.reason}`);

    return {
      hypothesis_id: input.hypothesis_id,
      status: updated.status,
      rejection_reason: input.reason,
    };
  }
}
