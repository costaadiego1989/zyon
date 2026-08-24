import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { BuyerAgentRow, M2MManagementStore, M2MProtocolConfigRow } from "../application/m2m-management.use-cases.js";

@Injectable()
export class PrismaM2MManagementStore implements M2MManagementStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listAgents(merchantId: string): Promise<BuyerAgentRow[]> {
    const rows = await (this.prisma as any).buyerAgent.findMany({
      where: { merchantId },
      include: { reputation: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r: any) => ({
      id: r.id,
      merchantId: r.merchantId,
      globalUserId: r.globalUserId,
      displayName: r.displayName,
      status: r.status,
      m2mSecretHash: r.m2mSecretHash,
      scopes: r.scopes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      reputation: r.reputation
        ? { transactionCount: r.reputation.transactionCount, disputeCount: r.reputation.disputeCount, reputationScore: r.reputation.reputationScore }
        : null,
    }));
  }

  async createAgent(data: Omit<BuyerAgentRow, "id" | "createdAt" | "updatedAt" | "reputation">): Promise<BuyerAgentRow> {
    const row = await (this.prisma as any).buyerAgent.create({
      data: {
        merchantId: data.merchantId,
        globalUserId: data.globalUserId,
        displayName: data.displayName,
        status: data.status,
        m2mSecretHash: data.m2mSecretHash,
        scopes: data.scopes,
        reputation: { create: { transactionCount: 0, disputeCount: 0, reputationScore: 100 } },
      },
      include: { reputation: true },
    });
    return {
      id: row.id,
      merchantId: row.merchantId,
      globalUserId: row.globalUserId,
      displayName: row.displayName,
      status: row.status,
      m2mSecretHash: row.m2mSecretHash,
      scopes: row.scopes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      reputation: row.reputation
        ? { transactionCount: row.reputation.transactionCount, disputeCount: row.reputation.disputeCount, reputationScore: row.reputation.reputationScore }
        : null,
    };
  }

  async findAgentById(merchantId: string, agentId: string): Promise<BuyerAgentRow | null> {
    const row = await (this.prisma as any).buyerAgent.findFirst({
      where: { id: agentId, merchantId },
      include: { reputation: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      merchantId: row.merchantId,
      globalUserId: row.globalUserId,
      displayName: row.displayName,
      status: row.status,
      m2mSecretHash: row.m2mSecretHash,
      scopes: row.scopes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      reputation: row.reputation
        ? { transactionCount: row.reputation.transactionCount, disputeCount: row.reputation.disputeCount, reputationScore: row.reputation.reputationScore }
        : null,
    };
  }

  async updateAgentStatus(merchantId: string, agentId: string, status: "active" | "suspended"): Promise<void> {
    await (this.prisma as any).buyerAgent.updateMany({
      where: { id: agentId, merchantId },
      data: { status },
    });
  }

  async getConfig(merchantId: string): Promise<M2MProtocolConfigRow | null> {
    const row = await (this.prisma as any).m2MProtocolConfig.findUnique({ where: { merchantId } });
    if (!row) return null;
    return {
      merchantId: row.merchantId,
      enabled: row.enabled,
      webhookUrl: row.webhookUrl,
      webhookEndpointId: row.webhookEndpointId,
      maxSessionTtlMinutes: row.maxSessionTtlMinutes,
    };
  }

  async upsertConfig(merchantId: string, data: Partial<M2MProtocolConfigRow>): Promise<M2MProtocolConfigRow> {
    const row = await (this.prisma as any).m2MProtocolConfig.upsert({
      where: { merchantId },
      create: {
        merchantId,
        enabled: data.enabled ?? false,
        webhookUrl: data.webhookUrl ?? null,
        webhookEndpointId: data.webhookEndpointId ?? null,
        maxSessionTtlMinutes: data.maxSessionTtlMinutes ?? 30,
      },
      update: {
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
        ...(data.webhookEndpointId !== undefined && { webhookEndpointId: data.webhookEndpointId }),
        ...(data.maxSessionTtlMinutes !== undefined && { maxSessionTtlMinutes: data.maxSessionTtlMinutes }),
      },
    });
    return {
      merchantId: row.merchantId,
      enabled: row.enabled,
      webhookUrl: row.webhookUrl,
      webhookEndpointId: row.webhookEndpointId,
      maxSessionTtlMinutes: row.maxSessionTtlMinutes,
    };
  }
}
