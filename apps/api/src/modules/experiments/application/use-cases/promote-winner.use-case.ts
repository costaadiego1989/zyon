import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { EXPERIMENT_REPOSITORY_PORT, type ExperimentRepositoryPort } from "../../domain/ports/experiment-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createExperimentEventEnvelope } from "../../domain/events/experiment-domain-event.js";

@Injectable()
export class PromoteWinnerUseCase {
  private readonly logger = new Logger(PromoteWinnerUseCase.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly experimentRepo: ExperimentRepositoryPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  async execute(experimentId: string, merchantId: string, winnerVariantId: string): Promise<void> {
    // Fetch experiment
    const experiment = await this.experimentRepo.findById(experimentId, merchantId);

    if (!experiment) {
      throw new Error(`EXPERIMENT_NOT_FOUND: ${experimentId}`);
    }

    if (experiment.status !== "running") {
      throw new Error(`CANNOT_PROMOTE_WINNER_UNLESS_RUNNING: status=${experiment.status}`);
    }

    // Verify winner variant exists
    const winner = experiment.variants.find((v) => v.id === winnerVariantId);
    if (!winner) {
      throw new Error(`VARIANT_NOT_FOUND: ${winnerVariantId}`);
    }

    try {
      // Complete the experiment
      const completed = experiment.complete();

      // Set winner
      const withWinner = completed.setWinner(winnerVariantId);

      // Persist
      await this.experimentRepo.save(withWinner);

      // Emit outbox event for revenue-manager to react
      const event = createExperimentEventEnvelope({
        eventType: "experiment.completed",
        merchantId,
        payload: {
          experiment_id: experimentId,
          winner_variant_id: winnerVariantId,
          winner_variant_name: winner.name,
        },
      });
      await this.outbox.appendOutbox(event);

      this.logger.log(
        `Promoted winner: experiment=${experimentId} winner=${winner.name} (${winnerVariantId})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to promote winner: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
