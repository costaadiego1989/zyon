import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  EXPERIMENT_REPOSITORY_PORT,
  type ExperimentRepositoryPort,
} from "../../domain/ports/experiment-repository.port.js";

export interface UpdateExperimentInput {
  merchant_id: string;
  experiment_id: string;
  name?: string;
  description?: string | null;
  variants?: Array<{
    id?: string;
    name: string;
    system_prompt: string;
    weight: number;
    is_control: boolean;
  }>;
}

@Injectable()
export class UpdateExperimentUseCase {
  private readonly logger = new Logger(UpdateExperimentUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
  ) {}

  async execute(input: UpdateExperimentInput): Promise<void> {
    const experiment = await this.repository.findById(input.experiment_id, input.merchant_id);
    if (!experiment) {
      throw new Error("EXPERIMENT_NOT_FOUND");
    }

    // Entity enforces draft-only update
    let updated = experiment;

    if (input.name !== undefined || input.description !== undefined) {
      updated = updated.update({
        name: input.name,
        description: input.description,
      });
    }

    if (input.variants) {
      updated = updated.updateVariants(input.variants);
    }

    await this.repository.save(updated);
    this.logger.debug(`Updated experiment ${input.experiment_id}`);
  }
}
