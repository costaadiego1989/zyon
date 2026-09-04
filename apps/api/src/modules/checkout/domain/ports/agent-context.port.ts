import type { AgentContext } from "@zyon/shared-types";

export const AGENT_CONTEXT_PORT = Symbol("AGENT_CONTEXT_PORT");

export interface AgentContextPort {
  get(input: {
    merchantId: string;
    userId?: string;
    agentId?: string;
    globalUserId?: string;
  }): Promise<AgentContext | undefined>;
}
