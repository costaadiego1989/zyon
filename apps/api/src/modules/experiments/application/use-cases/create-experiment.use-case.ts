import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  EXPERIMENT_REPOSITORY_PORT,
  type ExperimentRepositoryPort,
} from "../../domain/ports/experiment-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { PromptExperimentEntity } from "../../domain/entities/prompt-experiment.entity.js";
import { createExperimentEventEnvelope } from "../../domain/events/experiment-domain-event.js";

export interface CreateExperimentInput {
  merchant_id: string;
  name: string;
  description?: string;
  variants: Array<{
    name: string;
    system_prompt: string;
    weight: number;
    is_control: boolean;
  }>;
}

export interface CreateExperimentOutput {
  experiment_id: string;
  status: string;
}

@Injectable()
export class CreateExperimentUseCase {
  private readonly logger = new Logger(CreateExperimentUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  async execute(input: CreateExperimentInput): Promise<CreateExperimentOutput> {
    // Check if merchant already has a running experiment
    const running = await this.repository.findRunning(input.merchant_id);
    if (running) {
      throw new Error("MERCHANT_ALREADY_HAS_RUNNING_EXPERIMENT");
    }

    // Create entity with validations
    const experiment = PromptExperimentEntity.create({
      merchant_id: input.merchant_id,
      name: input.name,
      description: input.description,
      variants: input.variants,
    });

    // Save
    await this.repository.save(experiment);

    // Emit event
    const event = createExperimentEventEnvelope({
      eventType: "experiment.created",
      merchantId: input.merchant_id,
      payload: {
        experiment_id: experiment.id,
        name: experiment.name,
        variant_count: experiment.variants.length,
      },
    });
    await this.outbox.appendOutbox(event);

    this.logger.debug(`Created experiment ${experiment.id} for merchant ${input.merchant_id}`);

    return {
      experiment_id: experiment.id,
      status: experiment.status,
    };
  }
}
