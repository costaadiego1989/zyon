import type { AgentContext, AgentRules, AgentRulesPatch } from "../agent-rules.types.js";

export class AgentRulesEntity {
  private constructor(private readonly props: AgentRules) {}

  static createDefault(input: {
    merchantId: string;
    userId?: string;
    agentId?: string;
    now?: Date;
  }): AgentRulesEntity {
    const now = (input.now ?? new Date()).toISOString();
    return new AgentRulesEntity({
      agentId: input.agentId ?? (input.userId ? `agt_${input.userId}` : "default"),
      merchantId: input.merchantId,
      userId: input.userId,
      scope: input.userId ? "user_agent" : "merchant_default",
      identity: {
        agentName: "Zion",
        persona: "checkout sales agent",
        tone: "consultative",
        language: "en-US",
        greeting: "Hi, I'm here to help you finalize with security."
      },
      capabilities: {
        priceObjectionHandling: true,
        shippingObjectionHandling: true,
        trustReassurance: true,
        paymentFrictionGuidance: true,
        escalation: true,
        machineToMachineNegotiation: false
      },
      guardrails: {
        forbidUnauthorizedDiscounts: true,
        forbidUnauthorizedFreeShipping: true,
        forbidDeliveryPromisesWithoutSource: true,
        forbidStockPromisesWithoutSource: true,
        forbidPaymentStatusClaims: true,
        forbidLegalMedicalFinancialAdvice: true,
        forbidAbusivePressure: true,
        blockedPhrases: [],
        requiredDisclaimers: ["Offers depend on store rules authorization."],
        escalationTriggers: ["customer requests delivery promise", "customer requests discount outside policy"]
      },
      checkoutSettings: {
        agentMode: "silent_until_trigger",
        openWidgetOnTrigger: true,
        cooldownSeconds: 120,
        maxInterventionsPerSession: 3,
        triggerPreferences: ["shipping_objection_detected", "coupon_field_clicked", "idle_30_seconds"],
        handoffEnabled: true
      },
      createdAt: now,
      updatedAt: now
    });
  }

  static rehydrate(snapshot: AgentRules): AgentRulesEntity {
    return new AgentRulesEntity(snapshot);
  }

  update(patch: AgentRulesPatch, now = new Date()): AgentRulesEntity {
    return new AgentRulesEntity({
      ...this.props,
      identity: { ...this.props.identity, ...patch.identity },
      capabilities: { ...this.props.capabilities, ...patch.capabilities },
      guardrails: {
        ...this.props.guardrails,
        ...patch.guardrails,
        blockedPhrases: patch.guardrails?.blockedPhrases ?? this.props.guardrails.blockedPhrases,
        requiredDisclaimers: patch.guardrails?.requiredDisclaimers ?? this.props.guardrails.requiredDisclaimers,
        escalationTriggers: patch.guardrails?.escalationTriggers ?? this.props.guardrails.escalationTriggers
      },
      checkoutSettings: {
        ...this.props.checkoutSettings,
        ...patch.checkoutSettings,
        triggerPreferences: patch.checkoutSettings?.triggerPreferences ?? this.props.checkoutSettings.triggerPreferences
      },
      updatedAt: now.toISOString()
    });
  }

  toContext(): AgentContext {
    return {
      merchant_id: this.props.merchantId,
      user_id: this.props.userId,
      agent_id: this.props.agentId,
      agent: this.props.identity,
      capabilities: this.props.capabilities,
      guardrails: this.props.guardrails,
      checkout_settings: this.props.checkoutSettings,
      copy_constraints: [
        "Mention offers only when authorized by deterministic modules.",
        "Never invent discounts, free shipping, delivery dates, stock, or payment status.",
        "Use escalation when the buyer requests something outside configured guardrails."
      ]
    };
  }

  snapshot(): AgentRules {
    return {
      ...this.props,
      identity: { ...this.props.identity },
      capabilities: { ...this.props.capabilities },
      guardrails: {
        ...this.props.guardrails,
        blockedPhrases: [...this.props.guardrails.blockedPhrases],
        requiredDisclaimers: [...this.props.guardrails.requiredDisclaimers],
        escalationTriggers: [...this.props.guardrails.escalationTriggers]
      },
      checkoutSettings: {
        ...this.props.checkoutSettings,
        triggerPreferences: [...this.props.checkoutSettings.triggerPreferences]
      }
    };
  }
}
