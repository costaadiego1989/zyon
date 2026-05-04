import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
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
    const created = AgentRulesEntity.createDefault({
      merchantId: principal.merchantId,
      userId: agentId ? undefined : principal.userId,
      agentId
    }).snapshot();
    return this.repository.save(created);
  }
}

@Injectable()
export class UpdateAgentRulesUseCase {
  constructor(@Inject(AGENT_RULES_REPOSITORY) private readonly repository: AgentRulesRepository) {}

  async execute(principal: AgentRulesPrincipal, patch: AgentRulesPatch, agentId?: string): Promise<AgentRules> {
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
    @Optional()
    @Inject(CHECKOUT_SETTINGS_CONTEXT_PORT)
    private readonly checkoutSettings?: CheckoutSettingsContextPort
  ) {}

  async execute(principal: AgentRulesPrincipal, agentId?: string): Promise<AgentContext> {
    const rules = agentId
      ? await this.repository.getByAgentId(principal.merchantId, agentId)
      : await this.repository.getDefault(principal.merchantId, principal.userId);
    if (!rules) {
      if (agentId) throw new NotFoundException("agent_rules_not_found");
      const created = await this.repository.save(
        AgentRulesEntity.createDefault({
          merchantId: principal.merchantId,
          userId: principal.userId
        }).snapshot()
      );
      return this.withCheckoutContext(AgentRulesEntity.rehydrate(created).toContext(), principal.merchantId);
    }
    return this.withCheckoutContext(AgentRulesEntity.rehydrate(rules).toContext(), principal.merchantId);
  }

  private async withCheckoutContext(context: AgentContext, merchantId: string): Promise<AgentContext> {
    const checkoutContext = await this.checkoutSettings?.getContext(merchantId);
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
