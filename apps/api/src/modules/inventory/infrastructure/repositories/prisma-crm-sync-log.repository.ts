import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type {
  CrmSyncLogRepositoryPort,
  CrmSyncLogRow,
  CrmSyncStage,
  CrmSyncStatus,
} from "../../domain/ports/crm-sync-log-repository.port.js";

@Injectable()
export class PrismaCrmSyncLogRepository implements CrmSyncLogRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: {
    merchantId: string;
    provider: string;
    email: string;
    stage: CrmSyncStage;
    status: CrmSyncStatus;
    errorCode?: string;
  }): Promise<void> {
    await this.prisma.crmSyncLog.create({
      data: {
        merchantId: entry.merchantId,
        provider: entry.provider,
        email: entry.email,
        stage: entry.stage,
        status: entry.status,
        errorCode: entry.errorCode ?? null,
      },
    });
  }

  async list(merchantId: string, limit = 50): Promise<CrmSyncLogRow[]> {
    const rows = await this.prisma.crmSyncLog.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((r) => ({
      id: r.id,
      merchantId: r.merchantId,
      provider: r.provider,
      email: r.email,
      stage: r.stage as CrmSyncStage,
      status: r.status as CrmSyncStatus,
      errorCode: r.errorCode,
      createdAt: r.createdAt,
    }));
  }

  async hasLeadFor(merchantId: string, email: string): Promise<boolean> {
    const existing = await this.prisma.crmSyncLog.findFirst({
      where: { merchantId, email, stage: "lead", status: "success" },
      select: { id: true },
    });
    return existing != null;
  }
}
