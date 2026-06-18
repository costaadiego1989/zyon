import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { InMemoryAgentRulesRepository } from "../infrastructure/in-memory-agent-rules.repository.js";
import type { CheckoutSettingsContextPort } from "../domain/ports/checkout-settings-context.port.js";
import {
  GetAgentContextUseCase,
  GetAgentRulesUseCase,
  UpdateAgentRulesUseCase
} from "./agent-rules.use-cases.js";

class FakeCheckoutSettingsContextPort implements CheckoutSettingsContextPort {
  async getContext(merchantId: string) {
    return {
      merchant_id: merchantId,
      checkout_settings: {
        mode: "manual_only" as const,
        open_widget_on_trigger: false,
        minimum_abandonment_score: 0.8,
        cooldown_seconds: 300,
        max_interventions_per_session: 1,
        enabled_triggers: ["payment_failed" as const],
        handoff_enabled: false
      },
      operational_constraints: ["Respect checkout-settings operational context."]
    };
  }
}

test("agent rules use cases create defaults and update user-specific agent context", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const getRules = new GetAgentRulesUseCase(repository);
  const updateRules = new UpdateAgentRulesUseCase(repository);
  const getContext = new GetAgentContextUseCase(repository);
  const principal = { merchantId: "mrc_1", userId: "usr_1" };

  const defaults = await getRules.execute(principal);
  assert.equal(defaults.userId, "usr_1");

  await updateRules.execute(principal, {
    identity: { agentName: "Nina" },
    capabilities: { machineToMachineNegotiation: true }
  });
  const context = await getContext.execute(principal);

  assert.equal(context.agent.agentName, "Nina");
  assert.equal(context.capabilities.machineToMachineNegotiation, true);
  assert.equal(context.copy_constraints.some((constraint) => constraint.includes("determinístic")), true);
});

test("agent rules use cases can manage named merchant agents", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const updateRules = new UpdateAgentRulesUseCase(repository);
  const getContext = new GetAgentContextUseCase(repository);

  await updateRules.execute(
    { merchantId: "mrc_1", userId: "usr_1" },
    { identity: { agentName: "Machine Broker" } },
    "agent-machine-1"
  );

  const context = await getContext.execute({ merchantId: "mrc_1", userId: "usr_1" }, "agent-machine-1");
  assert.equal(context.agent_id, "agent-machine-1");
  assert.equal(context.agent.agentName, "Machine Broker");
});

test("agent rules context can create a merchant default without user identity", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const getContext = new GetAgentContextUseCase(repository);

  const context = await getContext.execute({ merchantId: "mrc_1" });

  assert.equal(context.merchant_id, "mrc_1");
  assert.equal(context.user_id, undefined);
  assert.equal(context.agent_id, "default");
  assert.equal(context.checkout_settings.agentMode, "silent_until_trigger");
});

test("agent rules context composes checkout-settings operational context", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const getContext = new GetAgentContextUseCase(repository, new FakeCheckoutSettingsContextPort());

  const context = await getContext.execute({ merchantId: "mrc_1" });

  assert.equal(context.checkout_settings.agentMode, "manual_only");
  assert.equal(context.checkout_settings.openWidgetOnTrigger, false);
  assert.equal(context.checkout_context?.checkout_settings.minimum_abandonment_score, 0.8);
  assert.equal(context.copy_constraints.includes("Respect checkout-settings operational context."), true);
});

// --- Regression tests for BUG P2: guardrail safety toggle enforcement ---

test("UpdateAgentRules rejects disabling forbidUnauthorizedDiscounts", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const updateRules = new UpdateAgentRulesUseCase(repository);
  const principal = { merchantId: "mrc_1", userId: "usr_1" };
  await assert.rejects(
    () => updateRules.execute(principal, { guardrails: { forbidUnauthorizedDiscounts: false } }),
    (err: unknown) => {
      assert.ok(err instanceof BadRequestException);
      assert.equal((err as BadRequestException).message, "guardrail_safety_toggle_forbidden");
      return true;
    }
  );
});

test("UpdateAgentRules rejects disabling forbidUnauthorizedFreeShipping", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const updateRules = new UpdateAgentRulesUseCase(repository);
  const principal = { merchantId: "mrc_1", userId: "usr_1" };
  await assert.rejects(
    () => updateRules.execute(principal, { guardrails: { forbidUnauthorizedFreeShipping: false } }),
    (err: unknown) => {
      assert.ok(err instanceof BadRequestException);
      assert.equal((err as BadRequestException).message, "guardrail_safety_toggle_forbidden");
      return true;
    }
  );
});

// --- Regression tests for BUG P3: GET read path must NOT persist ---

test("GetAgentRules does NOT persist on read (side-effect-free)", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const getRules = new GetAgentRulesUseCase(repository);
  const principal = { merchantId: "mrc_new", userId: "usr_new" };

  await getRules.execute(principal);

  // Nothing should have been saved — getDefault returns undefined
  const saved = await repository.getDefault("mrc_new", "usr_new");
  assert.equal(saved, undefined);
});

test("GetAgentContext does NOT persist on read (side-effect-free)", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const getContext = new GetAgentContextUseCase(repository);
  const principal = { merchantId: "mrc_new2", userId: "usr_new2" };

  await getContext.execute(principal);

  // Nothing should have been saved — getDefault returns undefined
  const saved = await repository.getDefault("mrc_new2", "usr_new2");
  assert.equal(saved, undefined);
});
