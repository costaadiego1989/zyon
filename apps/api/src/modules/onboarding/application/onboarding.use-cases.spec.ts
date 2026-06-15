import test from "node:test";
import assert from "node:assert/strict";
import { GetOnboardingStateUseCase } from "./get-onboarding-state.use-case.js";
import { CompleteOnboardingStepUseCase } from "./complete-onboarding-step.use-case.js";
import { InMemoryOnboardingStateRepository } from "../infrastructure/in-memory-onboarding-state.repository.js";
import { InMemoryOutboxRepository } from "../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function setup() {
  const repo = new InMemoryOnboardingStateRepository();
  const outbox = new InMemoryOutboxRepository();
  return {
    repo,
    outbox,
    get: new GetOnboardingStateUseCase(repo),
    complete: new CompleteOnboardingStepUseCase(repo, outbox)
  };
}

test("GetOnboardingState seeds account step as completed and persists", async () => {
  const { get, repo } = setup();

  const state = await get.execute("mrc_1");

  assert.equal(state.merchant_id, "mrc_1");
  assert.equal(state.completed, false);
  assert.equal(state.next_step, "checkout_config");
  const account = state.steps.find((s) => s.id === "account");
  assert.equal(account?.status, "completed");
  // Persisted so a second read returns the same progress.
  assert.ok(await repo.findByMerchant("mrc_1"));
});

test("GetOnboardingState rejects empty merchant", async () => {
  const { get } = setup();
  await assert.rejects(() => get.execute("  "), /onboarding_merchant_required/);
});

test("CompleteOnboardingStep advances next_step and emits event", async () => {
  const { complete, outbox } = setup();

  const state = await complete.execute({ merchantId: "mrc_1", step: "checkout_config" });

  assert.equal(state.steps.find((s) => s.id === "checkout_config")?.status, "completed");
  assert.equal(state.next_step, "embed");
  const events = await outbox.listOutbox("mrc_1");
  assert.equal(events.filter((e) => e.event_type === "merchant.onboarding.step.completed").length, 1);
});

test("CompleteOnboardingStep is idempotent (no duplicate events)", async () => {
  const { complete, outbox } = setup();

  await complete.execute({ merchantId: "mrc_1", step: "checkout_config" });
  await complete.execute({ merchantId: "mrc_1", step: "checkout_config" });

  const events = await outbox.listOutbox("mrc_1");
  assert.equal(events.filter((e) => e.event_type === "merchant.onboarding.step.completed").length, 1);
});

test("CompleteOnboardingStep emits onboarding.completed once all steps done", async () => {
  const { complete, outbox } = setup();

  await complete.execute({ merchantId: "mrc_1", step: "checkout_config" });
  await complete.execute({ merchantId: "mrc_1", step: "embed" });
  const final = await complete.execute({ merchantId: "mrc_1", step: "publish" });

  assert.equal(final.completed, true);
  assert.ok(final.completed_at);
  assert.equal(final.next_step, undefined);
  const events = await outbox.listOutbox("mrc_1");
  assert.equal(events.filter((e) => e.event_type === "merchant.onboarding.completed").length, 1);
});

test("CompleteOnboardingStep rejects unknown step", async () => {
  const { complete } = setup();
  await assert.rejects(
    () => complete.execute({ merchantId: "mrc_1", step: "bogus" }),
    /onboarding_step_invalid/
  );
});

test("onboarding state is tenant-scoped", async () => {
  const { get } = setup();
  const a = await get.execute("mrc_a");
  const b = await get.execute("mrc_b");
  assert.equal(a.merchant_id, "mrc_a");
  assert.equal(b.merchant_id, "mrc_b");
});
