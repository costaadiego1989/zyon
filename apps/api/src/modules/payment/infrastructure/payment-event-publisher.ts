/**
 * Redis Pub/Sub publisher for payment status changes.
 *
 * Emits payment status transitions to a per-intent Redis channel
 * (`payment:status:{intentId}`) so WebSocket gateways on any API
 * instance can notify the correct buyer, and stores the last known
 * status (`payment:status:last:{intentId}`, TTL 30min) so a late
 * connecting client can recover the current state.
 *
 * Graceful fallback: if Redis is unavailable, every operation is a
 * no-op and never throws — the system must work without Redis.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { REDIS_CLIENT_TOKEN } from "../../../shared/cache/redis.module.js";

type RedisClient = any; // ioredis v5 ESM compatibility

interface PaymentStatusPayload {
  intentId: string;
  status: string;
  merchantId: string;
  at: string;
}

@Injectable()
export class PaymentEventPublisher {
  private readonly logger = new Logger(PaymentEventPublisher.name);
  private readonly lastStatusTtl = 1800; // 30 minutes

  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: RedisClient | null
  ) {}

  async publishStatusChange(
    intentId: string,
    status: string,
    merchantId: string,
    at?: string
  ): Promise<void> {
    if (!this.redis) {
      this.logger.debug(
        `Redis unavailable — skipping status publish for intent ${intentId}`
      );
      return;
    }

    const payload: PaymentStatusPayload = {
      intentId,
      status,
      merchantId,
      at: at ?? new Date().toISOString(),
    };
    const serialized = JSON.stringify(payload);
    const channel = `payment:status:${intentId}`;
    const lastKey = `payment:status:last:${intentId}`;

    try {
      await this.redis.publish(channel, serialized);
      await this.redis.set(lastKey, serialized, "EX", this.lastStatusTtl);
    } catch (error) {
      this.logger.error(
        `Failed to publish payment status for intent ${intentId}: ${(error as Error).message}`
      );
    }
  }
}
