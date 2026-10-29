import { Injectable } from "@nestjs/common";
import type { OtpRecord, OtpStore } from "../domain/ports/otp-store.port.js";

/**
 * In-memory OTP store for unit tests.
 * Satisfies the OtpStore port without Prisma.
 */
@Injectable()
export class InMemoryOtpStore implements OtpStore {
  private readonly records = new Map<string, OtpRecord>();

  async save(record: Omit<OtpRecord, "attempts" | "consumedAt">): Promise<void> {
    this.records.set(record.phone, {
      ...record,
      attempts: 0,
      consumedAt: null,
    });
  }

  async findActive(phone: string, now = new Date()): Promise<OtpRecord | null> {
    const record = this.records.get(phone);
    if (!record) return null;
    if (record.consumedAt !== null) return null;
    if (record.expiresAt <= now) return null;
    return { ...record };
  }

  async incrementAttempts(phone: string): Promise<OtpRecord | null> {
    const record = this.records.get(phone);
    if (!record) return null;
    record.attempts += 1;
    return { ...record };
  }

  async consume(phone: string, now = new Date()): Promise<void> {
    const record = this.records.get(phone);
    if (record) {
      record.consumedAt = now;
    }
  }

  clear(): void {
    this.records.clear();
  }
}
