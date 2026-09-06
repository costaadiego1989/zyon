import { Injectable, Inject, Optional, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import {
  OUTBOX_REPOSITORY, OUTBOX_LEASE_MS, OUTBOX_MAX_ATTEMPTS,
  type LeasedOutboxClaim, type LeasedOutboxRepository,
} from "./ports/outbox.repository.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../events/domain-event-bus.port.js";

export const OUTBOX_DISPATCHER_OPTIONS = Symbol("OUTBOX_DISPATCHER_OPTIONS");
export interface OutboxDispatcherOptions {
  concurrency: number;
  drainTimeoutMs: number;
}
const DISPATCH_INTERVAL_MS = 100;
const MAX_PER_ROUND = 50;
const ERROR_COOLDOWN_MS = 10_000;
const METRICS_INTERVAL_MS = 30_000;
const BACKLOG_WARN_MS = 60_000;
const HANDLER_WARN_MS = 30_000;

@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly options: OutboxDispatcherOptions;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private shutdown: Promise<void> | undefined;
  private readonly heartbeats = new Set<ReturnType<typeof setInterval>>();
  private stopping = false;
  private abandoning = false;
  private inFlight = 0;
  private lastErrorAt = 0;
  private lastMetricsAt = 0;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: LeasedOutboxRepository,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Optional() @Inject(OUTBOX_DISPATCHER_OPTIONS) options?: Partial<OutboxDispatcherOptions>,
  ) {
    this.options = { concurrency: 4, drainTimeoutMs: 30_000, ...options };
    if (!Number.isSafeInteger(this.options.concurrency) || this.options.concurrency < 1 || this.options.concurrency > 50
      || !Number.isSafeInteger(this.options.drainTimeoutMs) || this.options.drainTimeoutMs < 1 || this.options.drainTimeoutMs > 120_000) {
      throw new Error("outbox_dispatcher_options_invalid");
    }
  }

  onApplicationBootstrap(): void {
    if (this.stopping || this.timer) return;
    // Redis-backed production instances delegate scheduling to the BullMQ relay.
    // The database lease remains the authoritative fence for each delivery.
    if (process.env.REDIS_URL?.trim()) {
      this.logger.log("Outbox dispatch delegated to BullMQ relay (REDIS_URL present)");
      return;
    }
    this.timer = setInterval(() => { void this.dispatch(); }, DISPATCH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    clearInterval(this.timer);
    this.shutdown = this.drainActive();
    return this.shutdown;
  }

  private async drainActive(): Promise<void> {
    if (!this.active) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      this.active.then(() => false),
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(true), this.options.drainTimeoutMs); }),
    ]);
    clearTimeout(timeout);
    if (timedOut) {
      this.abandoning = true;
      for (const heartbeat of this.heartbeats) clearInterval(heartbeat);
      this.heartbeats.clear();
      // Never release an active side effect. Its lease expires for another process.
      this.logger.error("outbox_drain_timeout in_flight=" + this.inFlight + " deadline_ms=" + this.options.drainTimeoutMs);
  }
  }

  dispatch(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.active) return this.active;
    if (Date.now() - this.lastErrorAt < ERROR_COOLDOWN_MS) return Promise.resolve();
    this.active = this.runRound().catch(() => {
      this.lastErrorAt = Date.now();
      this.logger.warn("outbox_dispatch_failed");
    }).finally(() => { this.active = undefined; });
    return this.active;
  }

  getStatus(): { inFlight: number; running: boolean; stopping: boolean; abandoned: boolean } {
    return { inFlight: this.inFlight, running: Boolean(this.active), stopping: this.stopping, abandoned: this.abandoning };
  }

  private async runRound(): Promise<void> {
    await this.reportBacklog();
    let remaining = MAX_PER_ROUND;
    while (!this.stopping && remaining > 0) {
      // Claim only available execution slots. No leased queue waits behind a slow handler.
      const claims = await this.outbox.claimBatch(Math.min(this.options.concurrency, remaining));
      if (!claims.length) return;
      if (this.stopping) {
        if (!this.abandoning) await Promise.all(claims.map((claim) => this.outbox.releaseUnstartedClaim(claim)));
        return;
      }
      remaining -= claims.length;
      const outcomes = await Promise.allSettled(claims.map((claim) => this.processOne(claim)));
      if (outcomes.some((outcome) => outcome.status === "rejected")) throw new Error("outbox_processing_failed");
    }
  }

  private async processOne(claim: LeasedOutboxClaim): Promise<void> {
    const { envelope } = claim;
    this.inFlight++;
    let leaseLost = false;
    let renewing: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (renewing || leaseLost || this.abandoning) return;
      renewing = Promise.resolve().then(() => this.outbox.renewClaim(claim)).then((renewed) => { leaseLost = !renewed; })
        .catch(() => { leaseLost = true; }).finally(() => { renewing = undefined; });
    }, OUTBOX_LEASE_MS / 4);
    heartbeat.unref();
    this.heartbeats.add(heartbeat);
    let errorCode = "outbox_handler_failed";
    const startedAt = Date.now();
    try {
      const handlers = this.eventBus.handlersFor(envelope.event_type);
      if (!handlers.length) {
        errorCode = "outbox_handler_missing";
        throw new Error(errorCode);
      }
      if (new Set(handlers.map((handler) => handler.handlerId)).size !== handlers.length) {
        errorCode = "outbox_handler_id_duplicate";
        throw new Error(errorCode);
      }
      const event = {
        eventId: envelope.event_id, eventType: envelope.event_type, merchantId: envelope.merchant_id,
        correlationId: envelope.correlation_id, causationId: envelope.causation_id,
        schemaVersion: envelope.schema_version, payload: envelope.payload,
      };
      for (const handler of handlers) {
        if (this.abandoning || leaseLost) return;
        // Confirm ownership before every side effect, including after long preceding handlers.
        if (!await this.outbox.renewClaim(claim)) { leaseLost = true; return; }
        if (await this.outbox.isHandlerProcessed(envelope.event_id, handler.handlerId)) continue;
        if (this.abandoning || leaseLost) return;
        await handler.handle(event);
        if (this.abandoning || leaseLost) return;
        if (!await this.outbox.completeHandler(claim, handler.handlerId)) { leaseLost = true; return; }
      }
      if (!this.abandoning && !leaseLost && !await this.outbox.completeClaim(claim)) leaseLost = true;
    } catch {
      if (!this.abandoning && !leaseLost) {
        const result = await this.outbox.failClaim(claim, errorCode,
          new Date(Date.now() + Math.min(1_000 * 2 ** (claim.attempts - 1), 60_000)));
        if (!result) leaseLost = true;
        else {
          const status = result.dead ? "dead" : "retry";
          this.logger[result.dead ? "error" : "warn"]("outbox_delivery_" + status
            + " event_id=" + envelope.event_id + " attempt=" + result.attempts + "/" + OUTBOX_MAX_ATTEMPTS + " code=" + errorCode);
        }
      }
    } finally {
      clearInterval(heartbeat);
      this.heartbeats.delete(heartbeat);
      await renewing;
      this.inFlight--;
      if (leaseLost) this.logger.warn("outbox_lease_lost event_id=" + envelope.event_id);
      const duration = Date.now() - startedAt;
      if (duration >= HANDLER_WARN_MS) this.logger.warn("outbox_handler_slow event_id=" + envelope.event_id + " duration_ms=" + duration);
    }
  }

  private async reportBacklog(): Promise<void> {
    if (Date.now() - this.lastMetricsAt < METRICS_INTERVAL_MS) return;
    const backlog = await this.outbox.getBacklog();
    this.lastMetricsAt = Date.now();
    const oldestAgeMs = backlog.oldestPendingAt ? Math.max(0, Date.now() - backlog.oldestPendingAt.getTime()) : 0;
    if (oldestAgeMs >= BACKLOG_WARN_MS || backlog.dead > 0) {
      this.logger.warn("outbox_backlog pending=" + backlog.pending + " processing=" + backlog.processing
        + " dead=" + backlog.dead + " oldest_pending_ms=" + oldestAgeMs);
    }
  }
}
