import type { Prisma } from "@prisma/client";
import type { AgentRules } from "../domain/agent-rules.types.js";

/**
 * M1: Explicit JSON converters for Prisma <-> domain. Extracted from repository
 * to improve testability and visibility into data shape transformations.
 */

export interface AgentRulesPrismaRow {
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
}

export function toCreate(rules: AgentRules) {
  return {
    agentId: rules.agentId,
    merchantId: rules.merchantId,
    userId: rules.userId,
    scope: rules.scope,
    ...toUpdate(rules)
  };
}

export function toUpdate(rules: AgentRules) {
  return {
    identity: rules.identity as unknown as Prisma.InputJsonValue,
    capabilities: rules.capabilities as unknown as Prisma.InputJsonValue,
    guardrails: rules.guardrails as unknown as Prisma.InputJsonValue,
    checkoutSettings: rules.checkoutSettings as unknown as Prisma.InputJsonValue,
    updatedAt: new Date(rules.updatedAt)
  };
}

export function toAgentRules(row: AgentRulesPrismaRow): AgentRules {
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
