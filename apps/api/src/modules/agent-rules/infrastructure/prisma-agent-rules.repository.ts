import type { Prisma, PrismaClient } from "@prisma/client";
import type { AgentRules } from "../domain/agent-rules.types.js";
import type { AgentRulesRepository } from "../domain/ports/agent-rules-repository.port.js";

export class PrismaAgentRulesRepository implements AgentRulesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getDefault(merchantId: string, userId?: string): Promise<AgentRules | undefined> {
    const row = await this.prisma.agentRule.findFirst({
      where: {
        merchantId,
        userId: userId ?? null,
        scope: userId ? "user_agent" : "merchant_default"
      }
    });
    return row ? toAgentRules(row) : undefined;
  }

  async getByAgentId(merchantId: string, agentId: string): Promise<AgentRules | undefined> {
    const row = await this.prisma.agentRule.findUnique({
      where: { merchantId_agentId: { merchantId, agentId } }
    });
    return row ? toAgentRules(row) : undefined;
  }

  async save(rules: AgentRules): Promise<AgentRules> {
    const row = await this.prisma.agentRule.upsert({
      where: { merchantId_agentId: { merchantId: rules.merchantId, agentId: rules.agentId } },
      create: toCreate(rules),
      update: toUpdate(rules)
    });
    return toAgentRules(row);
  }
}

function toCreate(rules: AgentRules) {
  return {
    agentId: rules.agentId,
    merchantId: rules.merchantId,
    userId: rules.userId,
    scope: rules.scope,
    ...toUpdate(rules)
  };
}

function toUpdate(rules: AgentRules) {
  return {
    identity: rules.identity as unknown as Prisma.InputJsonValue,
    capabilities: rules.capabilities as unknown as Prisma.InputJsonValue,
    guardrails: rules.guardrails as unknown as Prisma.InputJsonValue,
    checkoutSettings: rules.checkoutSettings as unknown as Prisma.InputJsonValue,
    updatedAt: new Date(rules.updatedAt)
  };
}

function toAgentRules(row: {
  agentId: string;
  merchantId: string;
  userId: string | null;
  scope: string;
  identity: unknown;
  capabilities: unknown;
  guardrails: unknown;
  checkoutSettings: unknown;
  createdAt: Date;
  updatedAt: Date;
}): AgentRules {
  return {
    agentId: row.agentId,
    merchantId: row.merchantId,
    userId: row.userId ?? undefined,
    scope: row.scope as AgentRules["scope"],
    identity: row.identity as AgentRules["identity"],
    capabilities: row.capabilities as AgentRules["capabilities"],
    guardrails: row.guardrails as AgentRules["guardrails"],
    checkoutSettings: row.checkoutSettings as AgentRules["checkoutSettings"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
