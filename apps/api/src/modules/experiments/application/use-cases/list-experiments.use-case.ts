import { Inject, Injectable, Logger } from "@nestjs/common";
import { EXPERIMENT_REPOSITORY_PORT, type ExperimentRepositoryPort } from "../../domain/ports/experiment-repository.port.js";
import type { PromptExperimentSnapshot } from "../../domain/entities/prompt-experiment.entity.js";

@Injectable()
export class ListExperimentsUseCase {
  private readonly logger = new Logger(ListExperimentsUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
  ) {}

  async execute(merchantId: string): Promise<PromptExperimentSnapshot[]> {
    const experiments = await this.repository.findByMerchant(merchantId);
    return experiments.map((e) => e.snapshot());
  }
}
