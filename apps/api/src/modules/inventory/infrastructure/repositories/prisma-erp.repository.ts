import type { PrismaClient } from "@prisma/client";
import { ERP_REPOSITORY, type ErpRepositoryPort, type ErpConnectionRow } from "../../domain/ports/erp-repository.port.js";

export class PrismaErpRepository implements ErpRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async list(merchantId: string): Promise<ErpConnectionRow[]> {
    const rows = await this.prisma.erpConnection.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      merchantId: r.merchantId,
      provider: r.provider,
      status: r.status,
      accessTokenCipher: r.accessTokenCipher,
      refreshTokenCipher: r.refreshTokenCipher,
      tokenExpiresAt: r.tokenExpiresAt,
      lastSyncAt: r.lastSyncAt,
      lastErrorCode: r.lastErrorCode,
      config: r.config as Record<string, unknown> | null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async findByProvider(merchantId: string, provider: string): Promise<ErpConnectionRow | null> {
    const row = await this.prisma.erpConnection.findUnique({
      where: { merchantId_provider: { merchantId, provider } },
    });
    if (!row) return null;
    return {
      id: row.id,
      merchantId: row.merchantId,
      provider: row.provider,
      status: row.status,
      accessTokenCipher: row.accessTokenCipher,
      refreshTokenCipher: row.refreshTokenCipher,
      tokenExpiresAt: row.tokenExpiresAt,
      lastSyncAt: row.lastSyncAt,
      lastErrorCode: row.lastErrorCode,
      config: row.config as Record<string, unknown> | null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsert(
    merchantId: string,
    provider: string,
    data: {
      status: string;
      accessTokenCipher?: string;
      refreshTokenCipher?: string;
      tokenExpiresAt?: Date;
      config?: Record<string, unknown>;
    }
  ): Promise<ErpConnectionRow> {
    const row = await this.prisma.erpConnection.upsert({
      where: { merchantId_provider: { merchantId, provider } },
      update: {
        status: data.status,
        accessTokenCipher: data.accessTokenCipher,
        refreshTokenCipher: data.refreshTokenCipher,
        tokenExpiresAt: data.tokenExpiresAt,
        config: data.config as any,
        lastErrorCode: null,
      },
      create: {
        merchantId,
        provider,
        status: data.status,
        accessTokenCipher: data.accessTokenCipher,
        refreshTokenCipher: data.refreshTokenCipher,
        tokenExpiresAt: data.tokenExpiresAt,
        config: data.config as any,
      },
    });
    return {
      id: row.id,
      merchantId: row.merchantId,
      provider: row.provider,
      status: row.status,
      accessTokenCipher: row.accessTokenCipher,
      refreshTokenCipher: row.refreshTokenCipher,
      tokenExpiresAt: row.tokenExpiresAt,
      lastSyncAt: row.lastSyncAt,
      lastErrorCode: row.lastErrorCode,
      config: row.config as Record<string, unknown> | null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async delete(merchantId: string, id: string): Promise<void> {
    await this.prisma.erpConnection.delete({
      where: { id, merchantId },
    });
  }

  async markSynced(merchantId: string, id: string): Promise<void> {
    await this.prisma.erpConnection.update({
      where: { id, merchantId },
      data: { lastSyncAt: new Date(), lastErrorCode: null },
    });
  }

  async markError(merchantId: string, id: string, errorCode: string): Promise<void> {
    await this.prisma.erpConnection.update({
      where: { id, merchantId },
      data: { lastErrorCode: errorCode },
    });
  }
}
