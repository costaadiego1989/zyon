import { Inject, Injectable, Optional } from "@nestjs/common";
import { EXPERIMENT_REPOSITORY_PORT, type ExperimentRepositoryPort } from "../../../experiments/domain/ports/experiment-repository.port.js";
import type { PromptExperimentPort, PromptExperimentVariant } from "../../domain/ports/prompt-experiment.port.js";

@Injectable()
export class PromptExperimentAdapter implements PromptExperimentPort {
  constructor(
    @Optional() @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly experimentRepo?: ExperimentRepositoryPort
  ) {}

  async findRunningExperiment(
    merchantId: string
  ): Promise<{ id: string; variants: PromptExperimentVariant[] } | undefined> {
    if (!this.experimentRepo) {
      return undefined;
    }

    const experiment = await this.experimentRepo.findRunning(merchantId);
    if (!experiment) {
      return undefined;
    }
    // A reviewed recipe reference is not a system prompt. Only the forthcoming
    // versioned execution path may bind it to an approved, measured exposure.
    if (experiment.variants.some(v => v.system_prompt.includes("checkout-chat-baseline-v1:"))) return undefined;

    return {
      id: experiment.id,
      variants: experiment.variants.map((v) => ({
        id: v.id,
        name: v.name,
        weight: v.weight,
        systemPrompt: v.system_prompt,
        isControl: v.is_control ?? false,
        appliedRuleId: (v as { applied_rule_id?: string | null }).applied_rule_id ?? null,
      })),
    };
  }
}
