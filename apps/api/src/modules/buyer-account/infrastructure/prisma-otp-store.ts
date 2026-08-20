import type { PrismaClient } from "@prisma/client";
import type { OtpRecord, OtpStore } from "../domain/ports/otp-store.port.js";

export class PrismaOtpStore implements OtpStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(record: Omit<OtpRecord, "attempts" | "consumedAt">): Promise<void> {
    await this.prisma.buyerPhoneOtp.upsert({
      where: { phone: record.phone },
      create: toCreate(record),
      update: toUpdate(record),
    });
  }

  async findActive(phone: string, now = new Date()): Promise<OtpRecord | null> {
    const record = await this.prisma.buyerPhoneOtp.findUnique({ where: { phone } });
    console.warn(`[OTP store] findActive("${phone}") raw=${JSON.stringify(record ? { phone: record.phone, expires: record.expiresAt, consumed: record.consumedAt, attempts: record.attempts } : null)} now=${now.toISOString()}`);
    if (!record || record.expiresAt <= now || record.consumedAt) return null;
    return toRecord(record);
  }

  async incrementAttempts(phone: string): Promise<OtpRecord | null> {
    try {
      const record = await this.prisma.buyerPhoneOtp.update({
        where: { phone },
        data: { attempts: { increment: 1 } },
      });
      return toRecord(record);
    } catch {
      return null;
    }
  }

  async consume(phone: string, now = new Date()): Promise<void> {
    await this.prisma.buyerPhoneOtp.update({ where: { phone }, data: { consumedAt: now } });
  }
}

function toCreate(record: Omit<OtpRecord, "attempts" | "consumedAt">) {
  return { ...toUpdate(record), phone: record.phone };
}

function toUpdate(record: Omit<OtpRecord, "attempts" | "consumedAt">) {
  return {
    codeHash: record.codeHash,
    maxAttempts: record.maxAttempts,
    attempts: 0,
    expiresAt: record.expiresAt,
    consumedAt: null,
  };
}

function toRecord(record: {
  phone: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}): OtpRecord {
  return {
    phone: record.phone,
    codeHash: record.codeHash,
    attempts: record.attempts,
    maxAttempts: record.maxAttempts,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
  };
}
