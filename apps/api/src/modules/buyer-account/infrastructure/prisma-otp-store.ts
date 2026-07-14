import type { PrismaClient } from "@prisma/client";
import type { OtpRecord, OtpStore } from "../domain/ports/otp-store.port.js";

/**
 * C1 fix: Persistent OTP store backed by Prisma.
 * Survives pod restarts; active OTPs are visible to all instances.
 * Backed by the BuyerPhoneOtp table in the Prisma schema.
 */
export class PrismaOtpStore implements OtpStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(record: Omit<OtpRecord, "attempts" | "consumedAt">): Promise<void> {
    await this.prisma.buyerPhoneOtp.upsert({
      where: { phone: record.phone },
      create: {
        phone: record.phone,
        codeHash: record.codeHash,
        maxAttempts: record.maxAttempts,
        attempts: 0,
        expiresAt: record.expiresAt,
        consumedAt: null,
      },
      update: {
        codeHash: record.codeHash,
        maxAttempts: record.maxAttempts,
        attempts: 0,
        expiresAt: record.expiresAt,
        consumedAt: null,
      },
    });
  }

  async findActive(phone: string, now = new Date()): Promise<OtpRecord | null> {
    const record = await this.prisma.buyerPhoneOtp.findUnique({
      where: { phone },
    });
    if (!record) return null;
    if (record.expiresAt < now || record.consumedAt) return null;
    return {
      phone: record.phone,
      codeHash: record.codeHash,
      attempts: record.attempts,
      maxAttempts: record.maxAttempts,
      expiresAt: record.expiresAt,
      consumedAt: record.consumedAt,
    };
  }

  async incrementAttempts(phone: string): Promise<OtpRecord | null> {
    try {
      const record = await this.prisma.buyerPhoneOtp.update({
        where: { phone },
        data: { attempts: { increment: 1 } },
      });
      return {
        phone: record.phone,
        codeHash: record.codeHash,
        attempts: record.attempts,
        maxAttempts: record.maxAttempts,
        expiresAt: record.expiresAt,
        consumedAt: record.consumedAt,
      };
    } catch {
      return null;
    }
  }

  async consume(phone: string, now = new Date()): Promise<void> {
    await this.prisma.buyerPhoneOtp.update({
      where: { phone },
      data: { consumedAt: now },
    });
  }
}
