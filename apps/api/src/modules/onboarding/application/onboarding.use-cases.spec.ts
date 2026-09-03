import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { GetOnboardingStateUseCase } from "./get-onboarding-state.use-case.js";
import { CompleteOnboardingStepUseCase } from "./complete-onboarding-step.use-case.js";
import { InMemoryOnboardingStateRepository } from "../infrastructure/in-memory-onboarding-state.repository.js";
import { InMemoryOutboxRepository } from "../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";

/** Stub merchant repo: all merchants with "mrc_" prefix exist. */
class StubMerchantRepository {
  async getProfile(merchantId: string) {
    if (merchantId.startsWith("mrc_")) return { name: "Test Merchant" };
    return undefined;
  }
  async getRules() { return {}; }
  async getStripeConnectAccountId() { return undefined; }
  async setStripeConnectAccountId() {}
  async updateRules() { return {}; }
  async updateTheme() { return {}; }
  async enableCrypto() {}
}

function setup() {
  const repo = new InMemoryOnboardingStateRepository();
  const outbox = new InMemoryOutboxRepository();
  const merchants = new StubMerchantRepository() as unknown as MerchantRepository;
  return {
    repo,
    outbox,
    get: new GetOnboardingStateUseCase(repo),
    complete: new CompleteOnboardingStepUseCase(repo, outbox, merchants)
  };
}

test("GetOnboardingState seeds account step as completed (returns in-memory default, does not persist)", async () => {
  const { get, repo } = setup();

  const state = await get.execute("mrc_1");

  assert.equal(state.merchant_id, "mrc_1");
  assert.equal(state.completed, false);
  assert.equal(state.next_step, "checkout_config");
  const account = state.steps.find((s) => s.id === "account");
  assert.equal(account?.status, "completed");
  // GET is side-effect-free: no row is persisted (lazy-persist on first write).
  assert.equal(repo.findByMerchant("mrc_1"), null);
});

test("GetOnboardingState rejects empty merchant", async () => {
  const { get } = setup();
  await assert.rejects(() => get.execute("  "), /onboarding_merchant_required/);
});

test("CompleteOnboardingStep advances next_step and emits event", async () => {
  const { complete, outbox } = setup();

  const state = await complete.execute({ merchantId: "mrc_1", step: "checkout_config" });

  assert.equal(state.steps.find((s) => s.id === "checkout_config")?.status, "completed");
  assert.equal(state.next_step, "whatsapp");
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
  await complete.execute({ merchantId: "mrc_1", step: "whatsapp" });
  const final = await complete.execute({ merchantId: "mrc_1", step: "ai_engine" });

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

// --- Regression tests for BUG P3: GET does not persist ---

test("GetOnboardingState does NOT persist on first read", async () => {
  const repo = new InMemoryOnboardingStateRepository();
  const get = new GetOnboardingStateUseCase(repo);

  await get.execute("mrc_new");

  // Verify no row was written — lazy-persist on first write is intentional.
  assert.equal(repo.findByMerchant("mrc_new"), null);
});

// --- Regression tests for BUG P3: step order enforcement ---

test("CompleteOnboardingStep rejects out-of-order step (whatsapp before checkout_config)", async () => {
  const { complete } = setup();
  await assert.rejects(
    () => complete.execute({ merchantId: "mrc_1", step: "whatsapp" }),
    (err: unknown) => {
      assert.ok(err instanceof BadRequestException);
      assert.equal((err as BadRequestException).message, "onboarding_step_out_of_order");
      return true;
    }
  );
});

test("CompleteOnboardingStep allows steps completed in canonical order", async () => {
  const { complete } = setup();
  // checkout_config first (account is pre-completed by withAccount)
  const s1 = await complete.execute({ merchantId: "mrc_1", step: "checkout_config" });
  assert.equal(s1.steps.find((s) => s.id === "checkout_config")?.status, "completed");
  // embed second — predecessors satisfied
  const s2 = await complete.execute({ merchantId: "mrc_1", step: "whatsapp" });
  assert.equal(s2.steps.find((s) => s.id === "whatsapp")?.status, "completed");
});

test("ONB-H1: CompleteOnboardingStep rejects non-existent merchant", async () => {
  const { complete } = setup();
  await assert.rejects(
    () => complete.execute({ merchantId: "nonexistent", step: "checkout_config" }),
    (err: unknown) => {
      assert.ok(err instanceof NotFoundException);
      return true;
    }
  );
});
