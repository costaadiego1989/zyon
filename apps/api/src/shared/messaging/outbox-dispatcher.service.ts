import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { OUTBOX_REPOSITORY, type OutboxClaim, type OutboxRepository } from "./ports/outbox.repository.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../events/domain-event-bus.port.js";

const DISPATCH_INTERVAL_MS = 100;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const ERROR_COOLDOWN_MS = 10_000;

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastErrorAt = 0;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus
  ) {}

  onModuleInit(): void {
    // When REDIS_URL is set, OutboxBullMqRelay drives dispatch() through a
    // Redis-locked recurring job (single active consumer across all instances).
    // The in-process setInterval is only the fallback for Redis-less dev/test.
    if (process.env.REDIS_URL?.trim()) {
      this.logger.log("Outbox dispatch delegated to BullMQ relay (REDIS_URL present)");
      return;
    }
    this.timer = setInterval(() => void this.dispatch(), DISPATCH_INTERVAL_MS);
    this.logger.log("Outbox dispatch: setInterval fallback (no REDIS_URL)");
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(): Promise<void> {
    if (this.running) return;
    if (Date.now() - this.lastErrorAt < ERROR_COOLDOWN_MS) return;
    this.running = true;
    try {
      const claims = await this.outbox.claimBatch(BATCH_SIZE);
      for (const claim of claims) {
        await this.processOne(claim);
      }
    } catch (err) {
      this.lastErrorAt = Date.now();
      this.logger.warn(`Outbox dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private async processOne(claim: OutboxClaim): Promise<void> {
    const { envelope } = claim;

    if (await this.outbox.isProcessed(envelope.event_id)) return;

    const handlers = this.eventBus.handlersFor(envelope.event_type);
    const event = {
      eventType: envelope.event_type,
      merchantId: envelope.merchant_id,
      payload: envelope.payload
    };

    try {
      for (const handler of handlers) {
        if (await this.outbox.isHandlerProcessed(envelope.event_id, handler.handlerId)) {
          continue;
        }
        await handler.handle(event);
        await this.outbox.markHandlerProcessed(envelope.event_id, handler.handlerId);
      }
      await this.outbox.markDelivered(envelope.event_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttemptNumber = claim.attempts + 1;
      const outcome = await this.outbox.recordFailure(envelope.event_id, message, {
        maxAttempts: MAX_ATTEMPTS,
        nextAttemptAt: new Date(Date.now() + this.backoffMs(nextAttemptNumber))
      });
      if (outcome.dead) {
        this.logger.error(
          `Outbox event ${envelope.event_id} moved to DLQ after ${outcome.attempts} attempts`,
          { merchant_id: envelope.merchant_id, event_type: envelope.event_type, correlation_id: envelope.correlation_id }
        );
      } else {
        this.logger.warn(
          `Outbox event ${envelope.event_id} failed (attempt ${outcome.attempts}/${MAX_ATTEMPTS}); retry scheduled`,
          { merchant_id: envelope.merchant_id, event_type: envelope.event_type, correlation_id: envelope.correlation_id }
        );
      }
    }
  }

  private backoffMs(attempt: number): number {
    const exponential = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    return Math.min(exponential, MAX_BACKOFF_MS);
  }
}
