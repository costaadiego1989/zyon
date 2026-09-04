import type { PrismaClient } from "@prisma/client";
import type { AgentRules } from "../domain/agent-rules.types.js";
import type { AgentRulesRepository } from "../domain/ports/agent-rules-repository.port.js";
import { toAgentRules, toCreate, toUpdate } from "./prisma-agent-rules.converters.js";

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
