import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import type { Redis } from "ioredis";
import { EventEmitter } from "node:events";
import { REDIS_CLIENT_TOKEN } from "../../../shared/cache/redis.module.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";

export interface SupportChange { merchantId: string; ticketId: string }

/** Redis carries invalidations only. The transactional outbox retries publication. */
@Injectable()
export class PlatformSupportRelay implements OnModuleInit, OnModuleDestroy {
  readonly events = new EventEmitter();
  private subscriber?: Redis;
  private readonly logger = new Logger(PlatformSupportRelay.name);
  private readonly channel = `zyon:${process.env.APP_ENV ?? process.env.NODE_ENV ?? "development"}:platform-support:v1`;

  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis | null,
    @Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
  ) {}

  async onModuleInit() {
    this.bus.subscribe("platform.support.changed", async event => {
      const payload = event.payload as { ticketId?: unknown };
      if (typeof payload?.ticketId !== "string") throw new Error("support_event_invalid");
      const change = { merchantId: event.merchantId, ticketId: payload.ticketId };
      if (this.redis) await this.redis.publish(this.channel, JSON.stringify(change));
      else this.events.emit("changed", change);
    }, "platform-support.realtime.v1");
    if (!this.redis) return;
    this.subscriber = this.redis.duplicate({ lazyConnect: true, enableOfflineQueue: true, maxRetriesPerRequest: 1 });
    this.subscriber.on("error", () => this.logger.warn("support_realtime_subscription_unavailable"));
    this.subscriber.on("ready", () => { void this.subscriber?.subscribe(this.channel).catch(() => this.logger.warn("support_realtime_start_pending")); });
    this.subscriber.on("message", (channel, raw) => {
      if (channel !== this.channel) return;
      try {
        const change = JSON.parse(raw) as SupportChange;
        if (typeof change.merchantId === "string" && typeof change.ticketId === "string") this.events.emit("changed", change);
      } catch { this.logger.warn("support_realtime_event_invalid"); }
    });
    try { await this.subscriber.connect(); }
    catch { this.logger.warn("support_realtime_start_pending"); }
  }

  async onModuleDestroy() {
    this.events.removeAllListeners();
    this.subscriber?.disconnect();
  }
}
