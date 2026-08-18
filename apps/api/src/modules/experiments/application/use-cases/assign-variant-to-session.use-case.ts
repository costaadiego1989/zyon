import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  EXPERIMENT_REPOSITORY_PORT,
  type ExperimentRepositoryPort,
} from "../../domain/ports/experiment-repository.port.js";

export interface AssignVariantInput {
  merchant_id: string;
  session_id: string;
}

export interface AssignVariantOutput {
  experiment_id: string;
  variant_id: string;
  variant_name: string;
  system_prompt: string;
}

@Injectable()
export class AssignVariantToSessionUseCase {
  private readonly logger = new Logger(AssignVariantToSessionUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
  ) {}

  async execute(input: AssignVariantInput): Promise<AssignVariantOutput | null> {
    const running = await this.repository.findRunning(input.merchant_id);
    if (!running) {
      return null; // No active experiment, use default behavior
    }

    const variants = running.variants;
    const selected = this.weightedRandom(variants);

    this.logger.debug(
      `Assigned variant "${selected.name}" to session ${input.session_id} in experiment ${running.id}`,
    );

    return {
      experiment_id: running.id,
      variant_id: selected.id,
      variant_name: selected.name,
      system_prompt: selected.system_prompt,
    };
  }

  private weightedRandom(variants: Array<{ id: string; name: string; system_prompt: string; weight: number }>): { id: string; name: string; system_prompt: string } {
    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
    let random = Math.random() * totalWeight;

    for (const variant of variants) {
      random -= variant.weight;
      if (random <= 0) {
        return { id: variant.id, name: variant.name, system_prompt: variant.system_prompt };
      }
    }

    // Fallback to last variant (should never happen with valid weights)
    const last = variants[variants.length - 1];
    return { id: last.id, name: last.name, system_prompt: last.system_prompt };
  }
}
