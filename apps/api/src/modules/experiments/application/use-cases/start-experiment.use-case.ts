import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  EXPERIMENT_REPOSITORY_PORT,
  type ExperimentRepositoryPort,
} from "../../domain/ports/experiment-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createExperimentEventEnvelope } from "../../domain/events/experiment-domain-event.js";

export interface StartExperimentInput {
  merchant_id: string;
  experiment_id: string;
}

@Injectable()
export class StartExperimentUseCase {
  private readonly logger = new Logger(StartExperimentUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  async execute(input: StartExperimentInput): Promise<void> {
    const experiment = await this.repository.findById(input.experiment_id, input.merchant_id);
    if (!experiment) {
      throw new Error("EXPERIMENT_NOT_FOUND");
    }

    const updated = experiment.start();
    await this.repository.save(updated);

    // Emit event
    const event = createExperimentEventEnvelope({
      eventType: "experiment.started",
      merchantId: input.merchant_id,
      payload: {
        experiment_id: experiment.id,
        name: experiment.name,
        variant_count: experiment.variants.length,
      },
    });
    await this.outbox.appendOutbox(event);

    this.logger.debug(`Started experiment ${input.experiment_id}`);
  }
}
