import { Injectable } from "@nestjs/common";
import type {
  EmailChangeOtpRecord,
  EmailChangeOtpStore,
} from "../domain/ports/email-change-otp-store.port.js";

/**
 * In-memory email-change OTP store for unit tests.
 */
@Injectable()
export class InMemoryEmailChangeOtpStore implements EmailChangeOtpStore {
  private readonly records = new Map<string, EmailChangeOtpRecord>();

  async save(record: Omit<EmailChangeOtpRecord, "attempts" | "consumedAt">): Promise<void> {
    this.records.set(record.userId, {
      ...record,
      attempts: 0,
      consumedAt: null,
    });
  }

  async findActive(userId: string, now = new Date()): Promise<EmailChangeOtpRecord | null> {
    const record = this.records.get(userId);
    if (!record) return null;
    if (record.consumedAt) return null;
    if (record.expiresAt <= now) return null;
    return { ...record };
  }

  async incrementAttempts(userId: string): Promise<EmailChangeOtpRecord | null> {
    const record = this.records.get(userId);
    if (!record) return null;
    record.attempts += 1;
    return { ...record };
  }

  async consume(userId: string, now = new Date()): Promise<void> {
    const record = this.records.get(userId);
    if (record) {
      record.consumedAt = now;
    }
  }

  clear(): void {
    this.records.clear();
  }
}
