import { Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import type {
  EmailChangeOtpRecord,
  EmailChangeOtpStore,
} from "../domain/ports/email-change-otp-store.port.js";

/**
 * Redis-backed email-change OTP store.
 * Stores under `email-change-otp:<userId>` with SETEX for auto-expiration.
 */
export class RedisEmailChangeOtpStore implements EmailChangeOtpStore {
  private readonly logger = new Logger(RedisEmailChangeOtpStore.name);

  constructor(private readonly redis: Redis) {}

  async save(record: Omit<EmailChangeOtpRecord, "attempts" | "consumedAt">): Promise<void> {
    const ttlSeconds = Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000);
    if (ttlSeconds <= 0) {
      this.logger.warn(`[EmailChangeOTP] skipping expired OTP for user ${record.userId}`);
      return;
    }

    const data: EmailChangeOtpRecord = {
      userId: record.userId,
      newEmail: record.newEmail,
      codeHash: record.codeHash,
      maxAttempts: record.maxAttempts,
      attempts: 0,
      expiresAt: record.expiresAt,
      consumedAt: null,
    };

    await this.redis.setex(this.getKey(record.userId), ttlSeconds, JSON.stringify(data));
  }

  async findActive(userId: string, now = new Date()): Promise<EmailChangeOtpRecord | null> {
    const raw = await this.redis.get(this.getKey(userId));
    if (!raw) return null;

    try {
      const record: EmailChangeOtpRecord = JSON.parse(raw);
      if (record.consumedAt) return null;
      if (record.expiresAt && new Date(record.expiresAt) <= now) {
        await this.redis.del(this.getKey(userId));
        return null;
      }
      return record;
    } catch (err) {
      this.logger.error(`[EmailChangeOTP] failed to parse record for ${userId}`, { error: err });
      await this.redis.del(this.getKey(userId));
      return null;
    }
  }

  async incrementAttempts(userId: string): Promise<EmailChangeOtpRecord | null> {
    const key = this.getKey(userId);
    const raw = await this.redis.get(key);
    if (!raw) return null;

    try {
      const record: EmailChangeOtpRecord = JSON.parse(raw);
      record.attempts += 1;

      const ttl = await this.redis.ttl(key);
      if (ttl > 0) {
        await this.redis.setex(key, ttl, JSON.stringify(record));
      } else {
        await this.redis.del(key);
        return null;
      }
      return record;
    } catch (err) {
      this.logger.error(`[EmailChangeOTP] failed to increment for ${userId}`, { error: err });
      return null;
    }
  }

  async consume(userId: string, now = new Date()): Promise<void> {
    const key = this.getKey(userId);
    const raw = await this.redis.get(key);
    if (!raw) return;

    try {
      const record: EmailChangeOtpRecord = JSON.parse(raw);
      record.consumedAt = now;
      const ttl = await this.redis.ttl(key);
      if (ttl > 0) {
        await this.redis.setex(key, ttl, JSON.stringify(record));
      } else {
        await this.redis.del(key);
      }
    } catch (err) {
      this.logger.error(`[EmailChangeOTP] failed to consume for ${userId}`, { error: err });
    }
  }

  private getKey(userId: string): string {
    return `email-change-otp:${userId}`;
  }
}
