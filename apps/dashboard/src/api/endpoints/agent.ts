import { dashboardJson } from "../http/client.js";
import type {
  AgentRules,
} from "../types.js";

export interface MerchantAgentConfiguration {
  identity: NonNullable<AgentRules["identity"]>;
  mode: "proactive" | "manual_only" | "silent_until_trigger";
  quickReplies: Record<string, string[]>;
  revision?: string;
}

export function agentEndpoints(base: string, f: typeof fetch) {
  return {
    getMerchantAgentConfiguration(): Promise<MerchantAgentConfiguration> {
      return dashboardJson(base, "/merchant-agent-configuration", { method: "GET" }, f);
    },
    putMerchantAgentConfiguration(payload: MerchantAgentConfiguration): Promise<MerchantAgentConfiguration> {
      return dashboardJson(base, "/merchant-agent-configuration", { method: "PUT", jsonBody: payload }, f);
    },
    getAgentRules(): Promise<AgentRules> {
      return dashboardJson(base, "/agent-rules", { method: "GET" }, f);
    },
    putAgentRules(payload: AgentRules): Promise<AgentRules> {
      return dashboardJson(base, "/agent-rules", { method: "PUT", jsonBody: payload }, f);
    },
    getAgentRulesContext(): Promise<Record<string, unknown>> {
      return dashboardJson(base, "/agent-rules/context", { method: "GET" }, f);
    },
  };
}
