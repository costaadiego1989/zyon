import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { HYPOTHESIS_REPOSITORY_PORT, type HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import { CreateExperimentUseCase } from "../../../experiments/application/use-cases/create-experiment.use-case.js";
import { StartExperimentUseCase } from "../../../experiments/application/use-cases/start-experiment.use-case.js";

export interface CreateExperimentFromHypothesisInput {
  merchant_id: string;
  hypothesis_id: string;
}

export interface CreateExperimentFromHypothesisOutput {
  experiment_id: string;
  hypothesis_id: string;
  status: "created" | "failed";
  error?: string;
}

/**
 * CreateExperimentFromHypothesisUseCase — Wraps approved hypothesis into experiment.
 *
 * 1. Fetch hypothesis
 * 2. Validate it is approved
 * 3. Call CreateExperimentUseCase with template variants
 * 4. Call StartExperimentUseCase to mark running
 * 5. Update hypothesis with created_experiment_id
 */
@Injectable()
export class CreateExperimentFromHypothesisUseCase {
  private readonly logger = new Logger(CreateExperimentFromHypothesisUseCase.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(HYPOTHESIS_REPOSITORY_PORT) private readonly hypothesisRepo: HypothesisRepositoryPort,
    private readonly createExperimentUseCase: CreateExperimentUseCase,
    private readonly startExperimentUseCase: StartExperimentUseCase,
  ) {}

  async execute(input: CreateExperimentFromHypothesisInput): Promise<CreateExperimentFromHypothesisOutput> {
    try {
      // Fetch hypothesis
      const hypothesis = await this.hypothesisRepo.findById(input.hypothesis_id, input.merchant_id);
      if (!hypothesis) {
        throw new Error(`HYPOTHESIS_NOT_FOUND: ${input.hypothesis_id}`);
      }

      if (hypothesis.status !== "approved") {
        throw new Error(`HYPOTHESIS_NOT_APPROVED: status=${hypothesis.status}`);
      }

      // Check if already has an experiment (idempotent)
      if (hypothesis.snapshot().created_experiment_id) {
        this.logger.log(`Hypothesis ${input.hypothesis_id} already has experiment ${hypothesis.snapshot().created_experiment_id}`);
        return {
          experiment_id: hypothesis.snapshot().created_experiment_id!,
          hypothesis_id: input.hypothesis_id,
          status: "created",
        };
      }

      const template = hypothesis.template;

      // Create experiment
      const result = await this.createExperimentUseCase.execute({
        merchant_id: input.merchant_id,
        name: template.name,
        description: template.description,
        variants: [
          {
            name: template.variant_a.name,
            system_prompt: template.variant_a.system_prompt,
            weight: template.variant_a.weight,
            is_control: template.variant_a.is_control,
          },
          {
            name: template.variant_b.name,
            system_prompt: template.variant_b.system_prompt,
            weight: template.variant_b.weight,
            is_control: template.variant_b.is_control,
          },
        ],
      });

      const experimentId = result.experiment_id;

      // Start experiment
      await this.startExperimentUseCase.execute({
        experiment_id: experimentId,
        merchant_id: input.merchant_id,
      });

      // Update hypothesis with created experiment id
      const updated = hypothesis.markExperimentCreated(experimentId);
      await this.hypothesisRepo.save(updated);

      this.logger.log(
        `Created and started experiment for hypothesis ${input.hypothesis_id}: exp=${experimentId}`,
      );

      return {
        experiment_id: experimentId,
        hypothesis_id: input.hypothesis_id,
        status: "created",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to create experiment for hypothesis ${input.hypothesis_id}: ${message}`,
      );

      // Mark hypothesis as failed
      try {
        const hypothesis = await this.hypothesisRepo.findById(input.hypothesis_id, input.merchant_id);
        if (hypothesis && hypothesis.status === "approved") {
          const failed = hypothesis.markExperimentFailed(message);
          await this.hypothesisRepo.save(failed);
        }
      } catch (updateErr) {
        this.logger.warn(`Failed to mark hypothesis as failed: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}`);
      }

      return {
        experiment_id: "",
        hypothesis_id: input.hypothesis_id,
        status: "failed",
        error: message,
      };
    }
  }
}
