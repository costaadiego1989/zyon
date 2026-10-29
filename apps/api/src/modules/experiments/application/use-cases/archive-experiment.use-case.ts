import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  EXPERIMENT_REPOSITORY_PORT,
  type ExperimentRepositoryPort,
} from "../../domain/ports/experiment-repository.port.js";

export interface ArchiveExperimentInput {
  merchant_id: string;
  experiment_id: string;
}

@Injectable()
export class ArchiveExperimentUseCase {
  private readonly logger = new Logger(ArchiveExperimentUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
  ) {}

  async execute(input: ArchiveExperimentInput): Promise<void> {
    const experiment = await this.repository.findById(input.experiment_id, input.merchant_id);
    if (!experiment) {
      throw new Error("EXPERIMENT_NOT_FOUND");
    }

    const updated = experiment.archive();
    await this.repository.save(updated);

    this.logger.debug(`Archived experiment ${input.experiment_id}`);
  }
}
