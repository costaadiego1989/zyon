export type InterventionPolicyInput = {
  proactiveEnabled: boolean;
  cooldownSeconds: number;
  maxInterventionsPerSession: number;
  nowUnix: number;
  triggerAgentFromScore: boolean;
  interventionCount: number;
  lastInterventionUnix: number | null;
};

export type InterventionPolicyDecision = {
  triggerAgent: boolean;
  suppressedReason?: "max_interventions" | "cooldown_active" | "proactive_disabled" | null;
};

export function decideInterventions(i: InterventionPolicyInput): InterventionPolicyDecision {
  if (!i.proactiveEnabled) {
    return { triggerAgent: false, suppressedReason: "proactive_disabled" };
  }
  if (!i.triggerAgentFromScore) {
    return { triggerAgent: false, suppressedReason: null };
  }
  if (i.interventionCount >= i.maxInterventionsPerSession) {
    return { triggerAgent: false, suppressedReason: "max_interventions" };
  }
  if (
    i.lastInterventionUnix !== null &&
    i.nowUnix - i.lastInterventionUnix < i.cooldownSeconds
  ) {
    return { triggerAgent: false, suppressedReason: "cooldown_active" };
  }
  return { triggerAgent: true, suppressedReason: null };
}
