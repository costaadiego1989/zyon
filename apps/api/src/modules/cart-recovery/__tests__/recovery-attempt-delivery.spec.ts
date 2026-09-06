import test from "node:test";
import assert from "node:assert/strict";
import { AttemptCartRecoveryUseCase, type AttemptCartRecoveryInput } from "../application/use-cases/attempt-cart-recovery.use-case.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";

const input: AttemptCartRecoveryInput = {
  merchantId: "merchant-test",
  sessionId: "checkout-test",
  globalUserId: "buyer-test",
  abandonmentScore: 0.6,
  events: ["shipping_objection_detected"],
  buyerHistory: { known_buyer: false, discount_sensitivity: "low", recent_skus: [] },
  merchantRules: { allowFreeShipping: false, maxDiscountPercent: 0 },
  buyerPhone: "test-only",
  buyerEmail: "buyer@example.invalid",
};
const clock = { now: () => new Date("2026-09-05T12:00:00.000Z") };

test("a skipped route does not mark recovery sent", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const useCase = new AttemptCartRecoveryUseCase(repo, clock, {
    execute: async () => ({ status: "skipped", channel: "none" }),
  });
  await useCase.execute(input);
  assert.equal(repo.getAll()[0]?.status, "pending");
  assert.equal(repo.getAll()[0]?.sentAt, null);
});

test("a definite rejection is failed and retains the selected channel", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const useCase = new AttemptCartRecoveryUseCase(repo, clock, {
    execute: async () => ({ status: "failed", channel: "whatsapp_template", reason: "rejected" }),
  });
  await useCase.execute(input);
  assert.equal(repo.getAll()[0]?.status, "failed");
  assert.equal(repo.getAll()[0]?.channel, "whatsapp_template");
  assert.equal(repo.getAll()[0]?.sentAt, null);
});

test("one routing call receives both contacts and sentAt follows provider acceptance", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  let resolveSend!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const accepted = new Promise<void>((resolve) => { resolveSend = resolve; });
  let message = "";
  let calls = 0;
  const useCase = new AttemptCartRecoveryUseCase(repo, clock, {
    execute: async (request) => {
      calls++;
      assert.equal(request.merchantId, input.merchantId);
      assert.equal(request.type, "cart_recovery");
      assert.equal(request.toPhone, input.buyerPhone);
      assert.equal(request.fallbackEmail, input.buyerEmail);
      message = request.freeformText ?? "";
      started(); await accepted;
      return { status: "sent", channel: "whatsapp_template", messageId: "test-id" };
    },
  });
  const execution = useCase.execute(input);
  await entered;
  assert.equal(repo.getAll()[0]?.status, "pending");
  assert.equal(repo.getAll()[0]?.sentAt, null);
  resolveSend();
  await execution;
  assert.equal(repo.getAll()[0]?.status, "sent");
  assert.equal(repo.getAll()[0]?.channel, "whatsapp_template");
  assert.equal(calls, 1);
  assert.deepEqual(repo.getAll()[0]?.sentAt, clock.now());
  assert.doesNotMatch(message, /tempo limitado|off|frete gr[aá]tis/i);
});

test("email-only buyers use the shared route and the actual channel is recorded", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  let calls = 0;
  const useCase = new AttemptCartRecoveryUseCase(repo, clock, {
    execute: async (request) => {
      calls++;
      assert.equal(request.toPhone, undefined);
      assert.equal(request.fallbackEmail, input.buyerEmail);
      return { messageId: "email-id", status: "sent", channel: "email" };
    },
  });
  await useCase.execute({ ...input, buyerPhone: undefined });
  assert.equal(repo.getAll()[0]?.status, "sent");
  assert.equal(repo.getAll()[0]?.channel, "email");
  assert.equal(calls, 1);
});

test("uncertain results and transport errors hold the attempt without retry or another channel", async () => {
  for (const throws of [false, true]) {
    const repo = new InMemoryRecoveryAttemptRepository();
    let calls = 0;
    const useCase = new AttemptCartRecoveryUseCase(repo, clock, {
      execute: async () => {
        calls++;
        if (throws) throw new Error("transport timeout after dispatch");
        return { status: "uncertain", channel: "whatsapp_template", reason: "timeout" };
      },
    });
    await useCase.execute(input);
    assert.equal(repo.getAll()[0]?.status, "unknown");
    assert.equal(repo.getAll()[0]?.sentAt, null);
    if (!throws) assert.equal(repo.getAll()[0]?.channel, "whatsapp_template");
    assert.deepEqual(await useCase.execute(input), { created: false });
    assert.equal(calls, 1);
  }
});

test("an invalid legacy channel cannot be recorded as an approved template send", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const useCase = new AttemptCartRecoveryUseCase(repo, clock, {
    execute: async () => ({ status: "sent", channel: "bubblewhats" }),
  });
  await useCase.execute(input);
  assert.equal(repo.getAll()[0]?.status, "unknown");
  assert.equal(repo.getAll()[0]?.sentAt, null);
});
