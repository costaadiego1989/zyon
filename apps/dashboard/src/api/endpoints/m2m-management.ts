import { dashboardJson } from "../http/client.js";

export interface M2MAgentResponse {
  id: string;
  merchantId: string;
  globalUserId: string;
  displayName: string;
  status: "active" | "suspended";
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  reputation: { transactionCount: number; disputeCount: number; reputationScore: number } | null;
}

export interface M2MProtocolConfigResponse {
  merchantId: string;
  enabled: boolean;
  webhookUrl: string | null;
  webhookEndpointId: string | null;
  maxSessionTtlMinutes: number;
}

export interface M2MAuditEntry {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export function m2mManagementEndpoints(base: string, f: typeof fetch) {
  return {
    async getM2MAgents(): Promise<{ agents: M2MAgentResponse[]; total: number }> {
      return dashboardJson(base, "/m2m/agents", { method: "GET" }, f);
    },

    async createM2MAgent(data: { displayName: string; globalUserId: string; scopes?: string[]; expiresInDays?: number }): Promise<M2MAgentResponse> {
      return dashboardJson(base, "/m2m/agents", { method: "POST", jsonBody: data }, f);
    },

    async suspendM2MAgent(agentId: string, suspend: boolean): Promise<{ ok: boolean }> {
      return dashboardJson(base, `/m2m/agents/${encodeURIComponent(agentId)}/suspend`, { method: "PUT", jsonBody: { suspend } }, f);
    },

    async getProtocolConfig(): Promise<M2MProtocolConfigResponse> {
      return dashboardJson(base, "/m2m/protocol/config", { method: "GET" }, f);
    },

    async putProtocolConfig(data: { enabled?: boolean; webhookUrl?: string | null; maxSessionTtlMinutes?: number }): Promise<M2MProtocolConfigResponse> {
      return dashboardJson(base, "/m2m/protocol/config", { method: "PUT", jsonBody: data }, f);
    },

    async getM2MAuditLog(params?: { limit?: number; resourceType?: string }): Promise<{ data: M2MAuditEntry[]; nextCursor: string | null }> {
      const query = new URLSearchParams();
      query.set("resourceType", params?.resourceType ?? "m2m");
      if (params?.limit) query.set("limit", String(params.limit));
      return dashboardJson(base, `/audit/events?${query}`, { method: "GET" }, f);
    },
  };
}
