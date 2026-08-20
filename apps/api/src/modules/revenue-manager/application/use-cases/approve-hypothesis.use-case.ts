import { Inject, Injectable, Logger } from "@nestjs/common";
import { HYPOTHESIS_REPOSITORY_PORT, type HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import type { DomainEventEnvelope } from "@zyon/shared-types";

export interface ApproveHypothesisInput {
  hypothesis_id: string;
  merchant_id: string;
  approved_by: string;
  approval_reason?: string;
}

export interface ApproveHypothesisOutput {
  hypothesis_id: string;
  status: string;
  approved_at: string;
}

@Injectable()
export class ApproveHypothesisUseCase {
  private readonly logger = new Logger(ApproveHypothesisUseCase.name);

  constructor(
    @Inject(HYPOTHESIS_REPOSITORY_PORT) private readonly hypothesisRepo: HypothesisRepositoryPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  async execute(input: ApproveHypothesisInput): Promise<ApproveHypothesisOutput> {
    const hypothesis = await this.hypothesisRepo.findById(input.hypothesis_id, input.merchant_id);
    if (!hypothesis) {
      throw new Error("HYPOTHESIS_NOT_FOUND");
    }

    const updated = hypothesis.approve(input.approved_by, input.approval_reason);
    await this.hypothesisRepo.save(updated);

    const event: DomainEventEnvelope = {
      event_id: `evt_${crypto.randomUUID()}`,
      event_type: "revenue_manager.hypothesis.approved",
      schema_version: 1,
      merchant_id: input.merchant_id,
      occurred_at: new Date().toISOString(),
      correlation_id: `corr_${crypto.randomUUID()}`,
      causation_id: "revenue_manager.approve_hypothesis",
      producer: "revenue-manager",
      payload: {
        hypothesis_id: input.hypothesis_id,
        approved_by: input.approved_by,
        expected_lift_percent: updated.snapshot().expected_lift_percent,
        risk_level: updated.risk_level,
      },
    };
    await this.outbox.appendOutbox(event);

    this.logger.log(`Hypothesis ${input.hypothesis_id} approved by ${input.approved_by}`);

    return {
      hypothesis_id: input.hypothesis_id,
      status: updated.status,
      approved_at: updated.snapshot().merchant_approved_at!,
    };
  }
}
