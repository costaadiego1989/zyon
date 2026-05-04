import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { startCheckoutRequest } from "../../__tests__/checkout-test-fixtures.js";
import { StartCheckoutUseCase } from "./start-checkout.use-case.js";

class ManualOnlyCheckoutSettingsPort implements CheckoutSettingsPort {
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

test("StartCheckoutUseCase creates session, records start event, and appends outbox fact", async () => {
  const repository = new InMemoryCheckoutRepository();
  const useCase = new StartCheckoutUseCase(repository);
  const response = await useCase.execute(startCheckoutRequest({ session_id: "chk_custom" }));

  const session = repository.getSession("mrc_1", "chk_custom");
  assert.equal(response.session_id, "chk_custom");
  assert.equal(session?.conversationId, response.conversation_id);
  assert.equal(session?.globalUserId, response.global_user_id);
  assert.equal(repository.listOutbox("mrc_1")[0]?.event_type, "checkout.session.started");
});

test("StartCheckoutUseCase reuses global user only inside the same merchant", async () => {
  const repository = new InMemoryCheckoutRepository();
  const useCase = new StartCheckoutUseCase(repository);

  const first = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_1", session_id: "chk_1" }));
  const second = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_1", session_id: "chk_2" }));
  const third = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_2", session_id: "chk_3" }));

  assert.equal(first.global_user_id, second.global_user_id);
  assert.notEqual(first.global_user_id, third.global_user_id);
});

test("StartCheckoutUseCase respects manual-only checkout settings", async () => {
  const repository = new InMemoryCheckoutRepository();
  const useCase = new StartCheckoutUseCase(repository, new ManualOnlyCheckoutSettingsPort());

  const response = await useCase.execute(startCheckoutRequest({ session_id: "chk_manual" }));

  assert.equal(response.agent_enabled, false);
  assert.equal(response.initial_mode, "silent");
});
