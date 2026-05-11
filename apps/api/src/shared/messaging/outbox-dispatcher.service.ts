import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "./ports/outbox.repository.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../events/domain-event-bus.port.js";
import type { DomainEventEnvelope } from "@aacp/shared-types";

const DISPATCH_INTERVAL_MS = 5_000;
const BATCH_SIZE = 50;

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatch(), DISPATCH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(): Promise<void> {
    const pending = await this.outbox.listPending(BATCH_SIZE);
    for (const envelope of pending) {
      await this.processOne(envelope);
    }
  }

  private async processOne(envelope: DomainEventEnvelope): Promise<void> {
    try {
      await this.eventBus.publish({
        eventType: envelope.event_type,
        merchantId: envelope.merchant_id,
        payload: envelope.payload
      });
      await this.outbox.markDelivered(envelope.event_id);
    } catch (err) {
      this.logger.error(`Failed to dispatch outbox event ${envelope.event_id}`, err);
      await this.outbox.markFailed(envelope.event_id);
    }
  }
}
