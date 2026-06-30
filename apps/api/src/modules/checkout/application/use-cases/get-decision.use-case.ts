import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { decideIntervention } from "@zyon/decision-engine";
import type { DecisionRequest, DecisionResponse } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { CHECKOUT_SETTINGS_PORT, type CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import {
  CHECKOUT_INTERVENTION_LEDGER,
  type CheckoutInterventionLedgerPort
} from "../../domain/ports/checkout-intervention-ledger.port.js";
import { decideInterventions } from "../../domain/services/intervention-policy.service.js";

@Injectable()
export class GetDecisionUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Optional() @Inject(CHECKOUT_SETTINGS_PORT) private readonly checkoutSettings?: CheckoutSettingsPort,
    @Optional() @Inject(CHECKOUT_INTERVENTION_LEDGER)
    private readonly interventionLedger?: CheckoutInterventionLedgerPort
  ) {}

  async execute(input: DecisionRequest): Promise<DecisionResponse> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const settings = await this.checkoutSettings?.getContext(input.merchant_id);
    if (settings?.checkout_settings.mode === "manual_only") {
      return {
        decision_id: `dec_${crypto.randomUUID()}`,
        action: "stay_silent",
        reason: "checkout_settings_manual_only",
        abandonment_score: session.abandonmentScore
      };
    }
    const decision = decideIntervention(session.abandonmentScore);
    const configuredTriggers = settings?.checkout_settings.enabled_triggers;
    const contextEvent = typeof input.context?.event === "string" ? input.context.event : undefined;
    const eventAllowed =
      contextEvent && configuredTriggers
        ? configuredTriggers.some((trigger) => trigger === contextEvent)
        : true;
    const meetsConfiguredScore = settings
      ? session.abandonmentScore >= settings.checkout_settings.minimum_abandonment_score
      : true;
    let trigger = decision.trigger && eventAllowed && meetsConfiguredScore;

    let reason: string | undefined = trigger
      ? decision.reason
      : !eventAllowed
        ? "checkout_settings_trigger_disabled"
        : settings && !meetsConfiguredScore
          ? "checkout_settings_below_minimum_score"
          : decision.reason;

    if (trigger && this.interventionLedger && settings) {
      const nowUnix = Math.floor(Date.now() / 1000);
      const interventionCount = await this.interventionLedger.countForSession(
        input.merchant_id,
        input.session_id
      );
      const lastInterventionUnix = await this.interventionLedger.lastOccurredAt(
        input.merchant_id,
        input.session_id
      );
      const pol = decideInterventions({
        proactiveEnabled: true,
        cooldownSeconds: settings.checkout_settings.cooldown_seconds,
        maxInterventionsPerSession: settings.checkout_settings.max_interventions_per_session,
        nowUnix,
        triggerAgentFromScore: true,
        interventionCount,
        lastInterventionUnix
      });
      if (!pol.triggerAgent) {
        trigger = false;
        if (pol.suppressedReason === "max_interventions") {
          reason = "intervention_ledger_max_interventions";
        } else if (pol.suppressedReason === "cooldown_active") {
          reason = "intervention_ledger_cooldown_active";
        } else if (pol.suppressedReason === "proactive_disabled") {
          reason = "intervention_ledger_proactive_disabled";
        } else {
          reason = decision.reason;
        }
      }
    }

    return {
      decision_id: `dec_${crypto.randomUUID()}`,
      action: trigger ? "trigger_agent" : "stay_silent",
      reason: reason ?? decision.reason,
      abandonment_score: session.abandonmentScore
    };
  }
}
