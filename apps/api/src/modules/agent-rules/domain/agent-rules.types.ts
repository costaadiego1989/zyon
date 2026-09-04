import type {
  AgentCapabilities,
  AgentCheckoutSettings,
  AgentGuardrails,
  AgentIdentity,
  AgentRuleScope
} from "@zyon/shared-types";

export type {
  AgentCapabilities,
  AgentCheckoutSettings,
  AgentContext,
  AgentGuardrails,
  AgentIdentity,
  AgentMode,
  AgentRuleScope,
  AgentTone
} from "@zyon/shared-types";

export interface AgentRules {
  agentId: string;
  merchantId: string;
  userId?: string;
  scope: AgentRuleScope;
  identity: AgentIdentity;
  capabilities: AgentCapabilities;
  guardrails: AgentGuardrails;
  checkoutSettings: AgentCheckoutSettings;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRulesPatch {
  identity?: Partial<AgentIdentity>;
  capabilities?: Partial<AgentCapabilities>;
  guardrails?: Partial<AgentGuardrails>;
  checkoutSettings?: Partial<AgentCheckoutSettings>;
}
