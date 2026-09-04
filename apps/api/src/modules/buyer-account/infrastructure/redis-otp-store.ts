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
      this.logger.warn(`[OTP Redis] skipping expired OTP for ${record.phone}`);
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
    this.logger.debug(`[OTP Redis] saved ${record.phone} with ${ttlSeconds}s TTL`);
  }

  async findActive(phone: string, now = new Date()): Promise<OtpRecord | null> {
    const key = this.getKey(phone);
    const raw = await this.redis.get(key);

    if (!raw) {
      this.logger.debug(`[OTP Redis] no record found for ${phone}`);
      return null;
    }

    try {
      const record: OtpRecord = JSON.parse(raw);

      // Check expiry
      if (record.expiresAt && new Date(record.expiresAt) <= now) {
        this.logger.debug(`[OTP Redis] record expired for ${phone}`);
        await this.redis.del(key);
        return null;
      }

      // Check if consumed
      if (record.consumedAt) {
        this.logger.debug(`[OTP Redis] record already consumed for ${phone}`);
        return null;
      }

      return record;
    } catch (err) {
      this.logger.error(`[OTP Redis] failed to parse record for ${phone}`, { error: err });
      await this.redis.del(key);
      return null;
    }
  }

  async incrementAttempts(phone: string): Promise<OtpRecord | null> {
    const key = this.getKey(phone);
    const raw = await this.redis.get(key);

    if (!raw) {
      this.logger.debug(`[OTP Redis] no record found for incrementing attempts on ${phone}`);
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
        this.logger.warn(`[OTP Redis] key ${phone} has no TTL, deleting`);
        await this.redis.del(key);
        return null;
      }

      return record;
    } catch (err) {
      this.logger.error(`[OTP Redis] failed to increment attempts for ${phone}`, { error: err });
      return null;
    }
  }

  async consume(phone: string, now = new Date()): Promise<void> {
    const key = this.getKey(phone);
    const raw = await this.redis.get(key);

    if (!raw) {
      this.logger.debug(`[OTP Redis] no record found to consume for ${phone}`);
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
        this.logger.debug(`[OTP Redis] key ${phone} already expired, deleting`);
        await this.redis.del(key);
      }
    } catch (err) {
      this.logger.error(`[OTP Redis] failed to consume OTP for ${phone}`, { error: err });
    }
  }

  private getKey(phone: string): string {
    return `otp:${phone}`;
  }
}
