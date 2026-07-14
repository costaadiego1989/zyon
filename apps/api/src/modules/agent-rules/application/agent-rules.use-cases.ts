import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AgentRulesEntity } from "../domain/entities/agent-rules.entity.js";
import type { AgentContext, AgentRules, AgentRulesPatch } from "../domain/agent-rules.types.js";
import {
  AGENT_RULES_REPOSITORY,
  type AgentRulesRepository
} from "../domain/ports/agent-rules-repository.port.js";
import {
  CHECKOUT_SETTINGS_CONTEXT_PORT,
  type CheckoutSettingsContextPort
} from "../domain/ports/checkout-settings-context.port.js";

export interface AgentRulesPrincipal {
  merchantId: string;
  userId?: string;
}

@Injectable()
export class GetAgentRulesUseCase {
  constructor(@Inject(AGENT_RULES_REPOSITORY) private readonly repository: AgentRulesRepository) {}

  async execute(principal: AgentRulesPrincipal, agentId?: string): Promise<AgentRules> {
    const existing = agentId
      ? await this.repository.getByAgentId(principal.merchantId, agentId)
      : await this.repository.getDefault(principal.merchantId, principal.userId);
    if (existing) return existing;
    // Return computed default in-memory — do NOT persist on read (side-effect-free GET).
    return AgentRulesEntity.createDefault({
      merchantId: principal.merchantId,
      userId: agentId ? undefined : principal.userId,
      agentId
    }).snapshot();
  }
}

@Injectable()
export class UpdateAgentRulesUseCase {
  constructor(@Inject(AGENT_RULES_REPOSITORY) private readonly repository: AgentRulesRepository) {}

  async execute(principal: AgentRulesPrincipal, patch: AgentRulesPatch, agentId?: string): Promise<AgentRules> {
    // Domain guardrail: safety toggles cannot be disabled.
    if (patch.guardrails?.forbidUnauthorizedDiscounts === false) {
      throw new BadRequestException("guardrail_safety_toggle_forbidden");
    }
    if (patch.guardrails?.forbidUnauthorizedFreeShipping === false) {
      throw new BadRequestException("guardrail_safety_toggle_forbidden");
    }

    const current = agentId
      ? await this.repository.getByAgentId(principal.merchantId, agentId)
      : await this.repository.getDefault(principal.merchantId, principal.userId);
    const entity = current
      ? AgentRulesEntity.rehydrate(current)
      : AgentRulesEntity.createDefault({
          merchantId: principal.merchantId,
          userId: agentId ? undefined : principal.userId,
          agentId
        });
    return this.repository.save(entity.update(patch).snapshot());
  }
}

@Injectable()
export class GetAgentContextUseCase {
  constructor(
    @Inject(AGENT_RULES_REPOSITORY) private readonly repository: AgentRulesRepository,
    @Inject(CHECKOUT_SETTINGS_CONTEXT_PORT)
    private readonly checkoutSettings: CheckoutSettingsContextPort
  ) {}

  async execute(principal: AgentRulesPrincipal, agentId?: string): Promise<AgentContext> {
    const rules = agentId
      ? await this.repository.getByAgentId(principal.merchantId, agentId)
      : await this.repository.getDefault(principal.merchantId, principal.userId);
    if (!rules) {
      if (agentId) throw new NotFoundException("agent_rules_not_found");
      // Return computed default in-memory — do NOT persist on read (side-effect-free GET).
      const defaultRules = AgentRulesEntity.createDefault({
        merchantId: principal.merchantId,
        userId: principal.userId
      }).snapshot();
      return this.enrichWithCheckoutContext(AgentRulesEntity.rehydrate(defaultRules).toContext(), principal.merchantId);
    }
    return this.enrichWithCheckoutContext(AgentRulesEntity.rehydrate(rules).toContext(), principal.merchantId);
  }

  private async enrichWithCheckoutContext(context: AgentContext, merchantId: string): Promise<AgentContext> {
    // Adapter is required (not optional). Call may still return undefined at runtime — that is an explicit
    // no-op and does not silently degrade the agent context.
    const checkoutContext = await this.checkoutSettings.getContext(merchantId);
    if (!checkoutContext) return context;
    return {
      ...context,
      checkout_settings: {
        agentMode: checkoutContext.checkout_settings.mode,
        openWidgetOnTrigger: checkoutContext.checkout_settings.open_widget_on_trigger,
        cooldownSeconds: checkoutContext.checkout_settings.cooldown_seconds,
        maxInterventionsPerSession: checkoutContext.checkout_settings.max_interventions_per_session,
        triggerPreferences: checkoutContext.checkout_settings.enabled_triggers,
        handoffEnabled: checkoutContext.checkout_settings.handoff_enabled
      },
      checkout_context: checkoutContext,
      copy_constraints: [...context.copy_constraints, ...checkoutContext.operational_constraints]
    };
  }
}
