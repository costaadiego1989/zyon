import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutSettingsPort } from "../domain/ports/checkout-settings.port.js";
import type { CheckoutTriggerName } from "@zyon/shared-types";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryInterventionLedger } from "../infrastructure/in-memory-intervention-ledger.js";
import { GetDecisionUseCase } from "../application/use-cases/get-decision.use-case.js";

class StrictCheckoutSettingsPort implements CheckoutSettingsPort {
  async getContext(merchantId: string) {
    return {
      merchant_id: merchantId,
      checkout_settings: {
        mode: "manual_only" as const,
        open_widget_on_trigger: false,
        minimum_abandonment_score: 0.9,
        cooldown_seconds: 300,
        max_interventions_per_session: 1,
        enabled_triggers: ["payment_failed" as const],
        handoff_enabled: false
      },
      operational_constraints: []
    };
  }
}

test("GetDecisionUseCase stays silent when checkout-settings is manual-only", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({ abandonmentScore: 0.95 }));
  const useCase = new GetDecisionUseCase(repository, new StrictCheckoutSettingsPort());

  const decision = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1" });

  assert.equal(decision.action, "stay_silent");
  assert.equal(decision.reason, "checkout_settings_manual_only");
});

test("GetDecisionUseCase keeps deterministic scoring but respects configured trigger event", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({ abandonmentScore: 0.95 }));
  const useCase = new GetDecisionUseCase(repository, {
    async getContext(merchantId: string) {
      return {
        merchant_id: merchantId,
        checkout_settings: {
          mode: "silent_until_trigger" as const,
          open_widget_on_trigger: true,
          minimum_abandonment_score: 0.7,
          cooldown_seconds: 120,
          max_interventions_per_session: 3,
          enabled_triggers: ["payment_failed" as const],
          handoff_enabled: true
        },
        operational_constraints: []
      };
    }
  });

  const decision = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    context: { event: "coupon_field_clicked" }
  });

  assert.equal(decision.action, "stay_silent");
  assert.equal(decision.reason, "checkout_settings_trigger_disabled");
});

const DECISION_LEDGER_TRIGGERS: CheckoutTriggerName[] = [
  "shipping_objection_detected",
  "coupon_field_clicked",
  "payment_failed",
  "exit_intent_detected",
  "idle_30_seconds"
];

class LedgerMaxTwoSettings implements CheckoutSettingsPort {
  async getContext(merchantId: string) {
    return {
      merchant_id: merchantId,
      checkout_settings: {
        mode: "silent_until_trigger" as const,
        open_widget_on_trigger: true,
        minimum_abandonment_score: 0,
        cooldown_seconds: 0,
        max_interventions_per_session: 2,
        enabled_triggers: DECISION_LEDGER_TRIGGERS,
        handoff_enabled: true
      },
      operational_constraints: []
    };
  }
}

test("GetDecisionUseCase respects intervention ledger when score would otherwise trigger", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({ abandonmentScore: 0.95 }));
  const ledger = new InMemoryInterventionLedger();
  await ledger.record({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    occurredAtUnix: 900,
    reason: "agent_trigger_allowed"
  });
  await ledger.record({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    occurredAtUnix: 1000,
    reason: "agent_trigger_allowed"
  });
  const useCase = new GetDecisionUseCase(repository, new LedgerMaxTwoSettings(), ledger);

  const decision = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    context: { event: "idle_30_seconds" }
  });

  assert.equal(decision.action, "stay_silent");
  assert.equal(decision.reason, "intervention_ledger_max_interventions");
});
