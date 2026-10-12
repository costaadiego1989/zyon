import { dashboardJson } from "../http/client.js";
import type {
  AgentRules,
} from "../types.js";

export function agentEndpoints(base: string, f: typeof fetch) {
  return {
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
