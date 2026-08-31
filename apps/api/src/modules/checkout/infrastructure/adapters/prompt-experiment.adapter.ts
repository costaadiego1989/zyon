import { Inject, Injectable, Optional } from "@nestjs/common";
import { EXPERIMENT_REPOSITORY_PORT, type ExperimentRepositoryPort } from "../../../experiments/domain/ports/experiment-repository.port.js";
import type { PromptExperimentPort } from "../../domain/ports/prompt-experiment.port.js";

@Injectable()
export class PromptExperimentAdapter implements PromptExperimentPort {
  constructor(
    @Optional() @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly experimentRepo?: ExperimentRepositoryPort
  ) {}

  async findRunningExperiment(
    merchantId: string
  ): Promise<{ id: string; variants: Array<{ id: string; name: string; weight: number; systemPrompt: string }> } | undefined> {
    if (!this.experimentRepo) {
      return undefined;
    }

    const experiment = await this.experimentRepo.findRunning(merchantId);
    if (!experiment) {
      return undefined;
    }

    return {
      id: experiment.id,
      variants: experiment.variants.map((v) => ({
        id: v.id,
        name: v.name,
        weight: v.weight,
        systemPrompt: v.system_prompt,
      })),
    };
  }
}
