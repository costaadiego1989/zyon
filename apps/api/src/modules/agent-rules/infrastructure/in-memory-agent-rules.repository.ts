import { Injectable } from "@nestjs/common";
import type { AgentRules } from "../domain/agent-rules.types.js";
import type { AgentRulesRepository } from "../domain/ports/agent-rules-repository.port.js";

@Injectable()
export class InMemoryAgentRulesRepository implements AgentRulesRepository {
  private rules = new Map<string, AgentRules>();

  async getDefault(merchantId: string, userId?: string): Promise<AgentRules | undefined> {
    const scope = userId ? "user_agent" : "merchant_default";
    return [...this.rules.values()].find((rules) => rules.merchantId === merchantId && rules.userId === userId && rules.scope === scope);
  }

  async getByAgentId(merchantId: string, agentId: string): Promise<AgentRules | undefined> {
    return this.rules.get(this.key(merchantId, agentId));
  }

  async save(rules: AgentRules): Promise<AgentRules> {
    this.rules.set(this.key(rules.merchantId, rules.agentId), rules);
    return rules;
  }

  private key(merchantId: string, agentId: string): string {
    return `${merchantId}:${agentId}`;
  }
}
