import { Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import { RecoveryAttempt, type RecoveryAttemptStatus } from "../../domain/entities/recovery-attempt.entity.js";
import type { RecoveryStrategy } from "../../domain/values/recovery-strategy.js";
import type { AbandonmentReason } from "../../domain/values/abandonment-reason.js";

@Injectable()
export class PrismaRecoveryAttemptRepository implements RecoveryAttemptRepositoryPort {
  private readonly logger = new Logger(PrismaRecoveryAttemptRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async save(attempt: RecoveryAttempt): Promise<void> {
    await this.prisma.recoveryAttempt.upsert({
      where: { id: attempt.id },
      create: {
        id: attempt.id,
        merchantId: attempt.merchantId,
        sessionId: attempt.sessionId,
        globalUserId: attempt.globalUserId,
        abandonmentReason: attempt.abandonmentReason,
        abandonmentScore: attempt.abandonmentScore,
        strategyJson: attempt.strategy as any,
        channel: attempt.channel,
        sentAt: attempt.sentAt,
        status: attempt.status,
        recoveredAt: attempt.recoveredAt,
        recoveredOrderId: attempt.recoveredOrderId,
      },
      update: {
        status: attempt.status,
        sentAt: attempt.sentAt,
        recoveredAt: attempt.recoveredAt,
        recoveredOrderId: attempt.recoveredOrderId,
      },
    });
  }

  async findById(id: string): Promise<RecoveryAttempt | null> {
    const row = await this.prisma.recoveryAttempt.findUnique({ where: { id } });
    return row ? this.toEntity(row) : null;
  }

  async findBySessionId(merchantId: string, sessionId: string): Promise<RecoveryAttempt[]> {
    const rows = await this.prisma.recoveryAttempt.findMany({
      where: { merchantId, sessionId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async existsForSession(merchantId: string, sessionId: string): Promise<boolean> {
    const count = await this.prisma.recoveryAttempt.count({
      where: { merchantId, sessionId },
    });
    return count > 0;
  }

  async findByMerchantAndStatus(merchantId: string, status: RecoveryAttemptStatus): Promise<RecoveryAttempt[]> {
    const rows = await this.prisma.recoveryAttempt.findMany({
      where: { merchantId, status },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async getMetrics(merchantId: string, from: Date, to: Date) {
    const [total, recovered, all] = await Promise.all([
      this.prisma.recoveryAttempt.count({
        where: { merchantId, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.recoveryAttempt.count({
        where: { merchantId, status: "recovered", createdAt: { gte: from, lte: to } },
      }),
      this.prisma.recoveryAttempt.findMany({
        where: { merchantId, createdAt: { gte: from, lte: to } },
        select: { strategyJson: true, status: true },
      }),
    ]);

    // Count abandoned sessions in the same window (sessions that triggered recovery)
    const totalAbandoned = await this.prisma.checkoutSession.count({
      where: {
        merchantId,
        triggerAgent: true,
        updatedAt: { gte: from, lte: to },
      },
    }).catch(() => total * 3); // fallback

    const strategies = all.map((r) => (r.strategyJson as any)?.type).filter(Boolean);
    const topStrategy = strategies.length > 0 ? mostFrequent(strategies) : null;

    return {
      total_abandoned: totalAbandoned,
      recovery_attempts: total,
      recovered,
      recovery_rate: total > 0 ? recovered / total : 0,
      revenue_recovered_cents: recovered * 15000, // TODO: track actual revenue
      top_strategy: topStrategy,
    };
  }

  private toEntity(row: any): RecoveryAttempt {
    return new RecoveryAttempt({
      id: row.id,
      merchantId: row.merchantId,
      sessionId: row.sessionId,
      globalUserId: row.globalUserId,
      abandonmentReason: row.abandonmentReason as AbandonmentReason,
      abandonmentScore: row.abandonmentScore,
      strategy: row.strategyJson as RecoveryStrategy,
      channel: row.channel as "in_session",
      sentAt: row.sentAt,
      status: row.status as RecoveryAttemptStatus,
      recoveredAt: row.recoveredAt,
      recoveredOrderId: row.recoveredOrderId,
      createdAt: row.createdAt,
    });
  }
}

function mostFrequent(arr: string[]): string {
  const freq: Record<string, number> = {};
  for (const s of arr) freq[s] = (freq[s] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]![0];
}
