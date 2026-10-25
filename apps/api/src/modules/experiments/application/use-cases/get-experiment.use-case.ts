import { Inject, Injectable, Logger } from "@nestjs/common";
import { EXPERIMENT_REPOSITORY_PORT, type ExperimentRepositoryPort } from "../../domain/ports/experiment-repository.port.js";
import type { PromptExperimentSnapshot } from "../../domain/entities/prompt-experiment.entity.js";

@Injectable()
export class GetExperimentUseCase {
  private readonly logger = new Logger(GetExperimentUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
  ) {}

  async execute(experimentId: string, merchantId: string): Promise<PromptExperimentSnapshot | null> {
    const entity = await this.repository.findById(experimentId, merchantId);
    return entity?.snapshot() ?? null;
  }
}
