import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort, type CrmConnectionRow } from "../../domain/ports/crm-connection-repository.port.js";

@Injectable()
export class PrismaCrmConnectionRepository implements CrmConnectionRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async list(merchantId: string): Promise<CrmConnectionRow[]> {
    const rows = await this.prisma.crmConnection.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(this.mapRow);
  }

  async findByProvider(merchantId: string, provider: string): Promise<CrmConnectionRow | null> {
    const row = await this.prisma.crmConnection.findUnique({
      where: { merchantId_provider: { merchantId, provider } },
    });
    return row ? this.mapRow(row) : null;
  }

  async upsert(
    merchantId: string,
    provider: string,
    data: { status: string; accessTokenCipher?: string; refreshTokenCipher?: string; tokenExpiresAt?: Date; config?: Record<string, unknown> }
  ): Promise<CrmConnectionRow> {
    const row = await this.prisma.crmConnection.upsert({
      where: { merchantId_provider: { merchantId, provider } },
      create: {
        merchantId,
        provider,
        status: data.status,
        accessTokenCipher: data.accessTokenCipher,
        refreshTokenCipher: data.refreshTokenCipher,
        tokenExpiresAt: data.tokenExpiresAt,
        config: data.config as any,
      },
      update: {
        status: data.status,
        accessTokenCipher: data.accessTokenCipher,
        refreshTokenCipher: data.refreshTokenCipher,
        tokenExpiresAt: data.tokenExpiresAt,
        config: data.config as any,
        updatedAt: new Date(),
      },
    });
    return this.mapRow(row);
  }

  async delete(merchantId: string, id: string): Promise<void> {
    await this.prisma.crmConnection.deleteMany({
      where: { id, merchantId },
    });
  }

  async markSynced(merchantId: string, id: string): Promise<void> {
    await this.prisma.crmConnection.updateMany({
      where: { id, merchantId },
      data: { lastSyncAt: new Date() },
    });
  }

  async markError(merchantId: string, id: string, errorCode: string): Promise<void> {
    await this.prisma.crmConnection.updateMany({
      where: { id, merchantId },
      data: { lastErrorCode: errorCode, status: "error" },
    });
  }

  private mapRow(row: any): CrmConnectionRow {
    return {
      id: row.id,
      merchantId: row.merchantId,
      provider: row.provider,
      status: row.status,
      accessTokenCipher: row.accessTokenCipher,
      lastSyncAt: row.lastSyncAt,
      lastErrorCode: row.lastErrorCode,
      createdAt: row.createdAt,
    };
  }
}
