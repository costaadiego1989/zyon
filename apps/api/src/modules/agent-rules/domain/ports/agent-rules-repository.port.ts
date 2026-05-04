import type { AgentRules } from "../agent-rules.types.js";

export const AGENT_RULES_REPOSITORY = Symbol("AGENT_RULES_REPOSITORY");

export interface AgentRulesRepository {
  getDefault(merchantId: string, userId?: string): Promise<AgentRules | undefined>;
  getByAgentId(merchantId: string, agentId: string): Promise<AgentRules | undefined>;
  save(rules: AgentRules): Promise<AgentRules>;
}
