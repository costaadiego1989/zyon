import type { Redis } from "ioredis";
import type { OtpRecord, OtpStore } from "../domain/ports/otp-store.port.js";
import { Logger } from "@nestjs/common";

/**
 * Redis-backed OTP store with automatic TTL expiration.
 * Keys are stored with SETEX to automatically expire after the TTL.
 * Implements the OtpStore interface for buyer phone/email OTP persistence.
 */
export class RedisOtpStore implements OtpStore {
  private readonly logger = new Logger(RedisOtpStore.name);

  constructor(private readonly redis: Redis) {}

  async save(record: Omit<OtpRecord, "attempts" | "consumedAt">): Promise<void> {
    const key = this.getKey(record.phone);
    const ttlSeconds = Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000);

    if (ttlSeconds <= 0) {
      this.logger.warn("otp_store.expired_record_rejected");
      return;
    }

    const data: OtpRecord = {
      phone: record.phone,
      codeHash: record.codeHash,
      maxAttempts: record.maxAttempts,
      attempts: 0,
      expiresAt: record.expiresAt,
      consumedAt: null,
    };

    // Store as JSON with SETEX for automatic expiration
    await this.redis.setex(key, ttlSeconds, JSON.stringify(data));
  }

  async findActive(phone: string, now = new Date()): Promise<OtpRecord | null> {
    const key = this.getKey(phone);
    const raw = await this.redis.get(key);

    if (!raw) {
      return null;
    }

    try {
      const record: OtpRecord = JSON.parse(raw);

      // Check expiry
      if (record.expiresAt && new Date(record.expiresAt) <= now) {
        await this.redis.del(key);
        return null;
      }

      // Check if consumed
      if (record.consumedAt) {
        return null;
      }

      return record;
    } catch {
      this.logger.error("otp_store.invalid_record");
      await this.redis.del(key);
      return null;
    }
  }

  async incrementAttempts(phone: string): Promise<OtpRecord | null> {
    const key = this.getKey(phone);
    const raw = await this.redis.get(key);

    if (!raw) {
      return null;
    }

    try {
      const record: OtpRecord = JSON.parse(raw);
      record.attempts += 1;

      // Get remaining TTL from Redis key
      const ttl = await this.redis.ttl(key);
      if (ttl > 0) {
        await this.redis.setex(key, ttl, JSON.stringify(record));
      } else {
        this.logger.warn("otp_store.missing_ttl");
        await this.redis.del(key);
        return null;
      }

      return record;
    } catch {
      this.logger.error("otp_store.increment_failed");
      return null;
    }
  }

  async consume(phone: string, now = new Date()): Promise<void> {
    const key = this.getKey(phone);
    const raw = await this.redis.get(key);

    if (!raw) {
      return;
    }

    try {
      const record: OtpRecord = JSON.parse(raw);
      record.consumedAt = now;

      // Get remaining TTL from Redis key
      const ttl = await this.redis.ttl(key);
      if (ttl > 0) {
        await this.redis.setex(key, ttl, JSON.stringify(record));
      } else {
        await this.redis.del(key);
      }
    } catch {
      this.logger.error("otp_store.consume_failed");
    }
  }

  private getKey(phone: string): string {
    return `otp:${phone}`;
  }
}
