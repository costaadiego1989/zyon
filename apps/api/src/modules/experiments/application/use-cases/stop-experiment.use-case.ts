import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  EXPERIMENT_REPOSITORY_PORT,
  type ExperimentRepositoryPort,
} from "../../domain/ports/experiment-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createExperimentEventEnvelope } from "../../domain/events/experiment-domain-event.js";

export interface StopExperimentInput {
  merchant_id: string;
  experiment_id: string;
}

@Injectable()
export class StopExperimentUseCase {
  private readonly logger = new Logger(StopExperimentUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  async execute(input: StopExperimentInput): Promise<void> {
    const experiment = await this.repository.findById(input.experiment_id, input.merchant_id);
    if (!experiment) {
      throw new Error("EXPERIMENT_NOT_FOUND");
    }

    const updated = experiment.complete();
    await this.repository.save(updated);

    // Emit event
    const event = createExperimentEventEnvelope({
      eventType: "experiment.completed",
      merchantId: input.merchant_id,
      payload: {
        experiment_id: experiment.id,
        name: experiment.name,
        started_at: experiment.started_at,
      },
    });
    await this.outbox.appendOutbox(event);

    this.logger.debug(`Stopped experiment ${input.experiment_id}`);
  }
}
