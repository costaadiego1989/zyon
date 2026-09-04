import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Queue, Worker } from "bullmq";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { RecordStrategyLessonUseCase } from "../../application/use-cases/record-strategy-lesson.use-case.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient, OutboxMessage } from "@prisma/client";

/**
 * StrategyFeedbackWorker — Listens to experiment.completed OutboxMessages
 *
 * Triggers when an experiment reaches "completed" status (via promote-winner use-case).
 * Fetches the associated hypothesis + experiment, records a strategy lesson,
 * and marks the outbox message as delivered.
 *
 * Polling every 30 seconds for pending "revenue_manager.experiment.completed" messages.
 * Falls back to setInterval when Redis unavailable.
 */
@Injectable()
export class StrategyFeedbackWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyFeedbackWorker.name);
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    private readonly recordLessonUseCase: RecordStrategyLessonUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async onModuleInit(): Promise<void> {
    // For now, use polling only (simple fallback)
    // In production, BullMQ + job queue can be added
    this.timer = setInterval(() => {
      void this.processExperimentCompletions().catch((err) => {
        this.logger.warn(`Strategy feedback worker error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 30 * 1_000); // Poll every 30 seconds

    this.logger.log("StrategyFeedbackWorker started (polling every 30s)");
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async processExperimentCompletions(): Promise<void> {
    try {
      // Find unprocessed experiment.completed events
      const pendingEvents = await this.prisma.outboxMessage.findMany({
        where: {
          eventType: "experiment.completed",
          status: "pending",
        },
        take: 10,
        orderBy: { occurredAt: "asc" },
      });

      for (const event of pendingEvents) {
        try {
          await this.handleExperimentCompleted(event);
          // Mark as delivered
          await this.outbox.markDelivered(event.eventId);
          this.logger.debug(`Processed experiment.completed event ${event.eventId}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Failed to process experiment.completed ${event.eventId}: ${message}`);
          // In production, use exponential backoff
          await this.outbox.markFailed(event.eventId, message);
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch pending events: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleExperimentCompleted(event: OutboxMessage): Promise<void> {
    const payload = event.payload as { experiment_id?: string; hypothesis_id?: string };

    if (!payload.experiment_id) {
      throw new Error("EXPERIMENT_ID_MISSING_IN_PAYLOAD");
    }

    // Find the hypothesis linked to this experiment
    const hypothesis = await this.prisma.revenueManagerHypothesis.findFirst({
      where: { createdExperimentId: payload.experiment_id },
    });

    if (!hypothesis) {
      this.logger.warn(`No hypothesis found for experiment ${payload.experiment_id}`);
      return; // Skip if no hypothesis (shouldn't happen)
    }

    // Record the strategy lesson
    await this.recordLessonUseCase.execute({
      merchant_id: event.merchantId,
      experiment_id: payload.experiment_id,
      hypothesis_id: hypothesis.id,
    });
  }
}
