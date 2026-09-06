import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { RecordStrategyLessonUseCase } from "../../application/use-cases/record-strategy-lesson.use-case.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

/** The shared dispatcher owns delivery, retries and shutdown for this handler. */
@Injectable()
export class StrategyFeedbackWorker implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    private readonly recordLessonUseCase: RecordStrategyLessonUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit(): void {
    this.events.subscribe("experiment.completed", (event) => this.handle(event),
      "revenue-manager.StrategyFeedbackWorker");
  }

  private async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as { experiment_id?: unknown } | null;
    if (!event.merchantId || typeof payload?.experiment_id !== "string" || !payload.experiment_id.trim()) {
      throw new Error("experiment_completion_scope_invalid");
    }
    const hypothesis = await this.prisma.revenueManagerHypothesis.findFirst({
      where: { merchantId: event.merchantId, createdExperimentId: payload.experiment_id },
      select: { id: true },
    });
    // Experiments created directly by the merchant need no strategy lesson.
    if (!hypothesis) return;
    await this.recordLessonUseCase.execute({
      merchant_id: event.merchantId,
      experiment_id: payload.experiment_id,
      hypothesis_id: hypothesis.id,
    });
  }
}
