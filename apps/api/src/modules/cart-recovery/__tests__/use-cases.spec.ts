import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { AttemptCartRecoveryUseCase, type Clock } from "../application/use-cases/attempt-cart-recovery.use-case.js";
import { TrackRecoveryOutcomeUseCase } from "../application/use-cases/track-recovery-outcome.use-case.js";
import { GetRecoveryMetricsUseCase } from "../application/use-cases/get-recovery-metrics.use-case.js";
import { RecoveryAttempt } from "../domain/entities/recovery-attempt.entity.js";

const fixedClock: Clock = { now: () => new Date("2026-08-20T10:00:00.000Z") };

function defaultBuyerHistory(overrides: Partial<{ known_buyer: boolean; discount_sensitivity: "high" | "medium" | "low"; recent_skus: string[] }> = {}) {
  return {
    known_buyer: false,
    discount_sensitivity: "low" as const,
    recent_skus: ["sku_a"],
    ...overrides,
  };
}

function defaultMerchantRules(overrides: Partial<{ allowFreeShipping: boolean; maxDiscountPercent: number }> = {}) {
  return {
    allowFreeShipping: true,
    maxDiscountPercent: 10,
    ...overrides,
  };
}

// --- AttemptCartRecovery ---

test("UC-15 — AttemptCartRecovery: session with score >= 0.55 → attempt created", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const useCase = new AttemptCartRecoveryUseCase(repo, fixedClock);

  const result = await useCase.execute({
    merchantId: "mrc_1",
    sessionId: "ses_1",
    globalUserId: "usr_1",
    abandonmentScore: 0.6,
    events: ["shipping_objection_detected"],
    buyerHistory: defaultBuyerHistory(),
    merchantRules: defaultMerchantRules(),
  });

  assert.equal(result.created, true);
  assert.ok(result.attemptId);
  assert.equal(repo.count(), 1);

  const attempt = repo.getAll()[0]!;
  assert.equal(attempt.merchantId, "mrc_1");
  assert.equal(attempt.sessionId, "ses_1");
  assert.equal(attempt.channel, "none");
  assert.equal(attempt.status, "pending");
});

test("UC-15b — AttemptCartRecovery: score below threshold → no attempt", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const useCase = new AttemptCartRecoveryUseCase(repo, fixedClock);

  const result = await useCase.execute({
    merchantId: "mrc_1",
    sessionId: "ses_1",
    globalUserId: "usr_1",
    abandonmentScore: 0.4,
    events: ["shipping_objection_detected"],
    buyerHistory: defaultBuyerHistory(),
    merchantRules: defaultMerchantRules(),
  });

  assert.equal(result.created, false);
  assert.equal(repo.count(), 0);
});

test("UC-16 — AttemptCartRecovery: attempt already exists → skip (dedup)", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const useCase = new AttemptCartRecoveryUseCase(repo, fixedClock);

  // First attempt succeeds
  await useCase.execute({
    merchantId: "mrc_1",
    sessionId: "ses_1",
    globalUserId: "usr_1",
    abandonmentScore: 0.6,
    events: ["shipping_objection_detected"],
    buyerHistory: defaultBuyerHistory(),
    merchantRules: defaultMerchantRules(),
  });

  // Second attempt same session → skip
  const result = await useCase.execute({
    merchantId: "mrc_1",
    sessionId: "ses_1",
    globalUserId: "usr_1",
    abandonmentScore: 0.7,
    events: ["coupon_field_clicked"],
    buyerHistory: defaultBuyerHistory({ discount_sensitivity: "high" }),
    merchantRules: defaultMerchantRules(),
  });

  assert.equal(result.created, false);
  assert.equal(repo.count(), 1);
});

test("UC-AttemptCartRecovery: no_action strategy → does NOT write attempt row", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const useCase = new AttemptCartRecoveryUseCase(repo, fixedClock);

  // unknown reason + score >= 0.7 → no_action
  const result = await useCase.execute({
    merchantId: "mrc_1",
    sessionId: "ses_1",
    globalUserId: "usr_1",
    abandonmentScore: 0.85,
    events: [],
    buyerHistory: defaultBuyerHistory(),
    merchantRules: defaultMerchantRules({ allowFreeShipping: false }),
  });

  assert.equal(result.created, false);
  assert.equal(repo.count(), 0);
});

// --- TrackRecoveryOutcome ---

test("AttemptCartRecovery waits without creating an attempt or dispatching either channel", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  let sends = 0;
  const useCase = new AttemptCartRecoveryUseCase(
    repo,
    fixedClock,
    { execute: async () => { sends++; return { messageId: "test", status: "sent", channel: "email" }; } },
  );

  const result = await useCase.execute({
    merchantId: "mrc_1",
    sessionId: "ses_wait",
    globalUserId: "usr_1",
    abandonmentScore: 0.6,
    events: [],
    buyerHistory: defaultBuyerHistory(),
    merchantRules: defaultMerchantRules(),
    buyerPhone: "test-phone",
    buyerEmail: "buyer@example.invalid",
  });

  assert.deepEqual(result, { created: false });
  assert.equal(repo.count(), 0);
  assert.equal(sends, 0);
});

function seedSentAttempt(repo: InMemoryRecoveryAttemptRepository, sentAt: Date): RecoveryAttempt {
  const attempt = new RecoveryAttempt({
    id: "rec_test",
    merchantId: "mrc_1",
    sessionId: "ses_1",
    globalUserId: "usr_1",
    abandonmentReason: "shipping_cost",
    abandonmentScore: 0.6,
    strategy: { type: "offer_free_shipping", condition: "merchant_allows_free_shipping" },
    channel: "in_session",
    sentAt,
    status: "sent",
    recoveredAt: null,
    recoveredOrderId: null,
    createdAt: new Date("2026-08-20T09:00:00.000Z"),
  });
  repo.save(attempt);
  return attempt;
}

test("UC-17 — TrackRecoveryOutcome: session reactivated within 24h → recovered", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const sentAt = new Date("2026-08-20T10:00:00.000Z");
  seedSentAttempt(repo, sentAt);

  const useCase = new TrackRecoveryOutcomeUseCase(repo);
  const result = await useCase.execute({
    merchantId: "mrc_1",
    sessionId: "ses_1",
    reactivatedAt: new Date("2026-08-20T12:00:00.000Z"), // 2 hours later
  });

  assert.equal(result.status, "recovered");
  const saved = await repo.findById("rec_test");
  assert.equal(saved?.status, "recovered");
});

test("UC-17b — TrackRecoveryOutcome: reactivation at exactly 23h59m → recovered (boundary)", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const sentAt = new Date("2026-08-20T10:00:00.000Z");
  seedSentAttempt(repo, sentAt);

  const reactivatedAt = new Date(sentAt.getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000); // 23h59m
  const useCase = new TrackRecoveryOutcomeUseCase(repo);
  const result = await useCase.execute({ merchantId: "mrc_1", sessionId: "ses_1", reactivatedAt });

  assert.equal(result.status, "recovered");
});

test("UC-18 — TrackRecoveryOutcome: no reactivation within 24h → expired", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const sentAt = new Date("2026-08-20T10:00:00.000Z");
  seedSentAttempt(repo, sentAt);

  const reactivatedAt = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000 + 1); // 24h + 1ms
  const useCase = new TrackRecoveryOutcomeUseCase(repo);
  const result = await useCase.execute({ merchantId: "mrc_1", sessionId: "ses_1", reactivatedAt });

  assert.equal(result.status, "expired");
});

test("UC-TrackRecoveryOutcome: reactivation BEFORE sent_at → failed", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const sentAt = new Date("2026-08-20T10:00:00.000Z");
  seedSentAttempt(repo, sentAt);

  const reactivatedAt = new Date(sentAt.getTime() - 60 * 60 * 1000); // 1h before
  const useCase = new TrackRecoveryOutcomeUseCase(repo);
  const result = await useCase.execute({ merchantId: "mrc_1", sessionId: "ses_1", reactivatedAt });

  assert.equal(result.status, "failed");
});

// --- GetRecoveryMetrics ---

test("UC-19 — GetRecoveryMetrics: aggregates correctly", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const baseDate = new Date("2026-08-15T10:00:00.000Z");

  // Seed 3 attempts: 1 recovered, 2 pending
  for (let i = 0; i < 3; i++) {
    const attempt = new RecoveryAttempt({
      id: `rec_${i}`,
      merchantId: "mrc_1",
      sessionId: `ses_${i}`,
      globalUserId: `usr_${i}`,
      abandonmentReason: "price",
      abandonmentScore: 0.6,
      strategy: { type: "escalate_discount", value_percent: 10, cap: 10 },
      channel: "in_session",
      sentAt: baseDate,
      status: i === 0 ? "recovered" : "pending",
      recoveredAt: i === 0 ? new Date("2026-08-15T12:00:00.000Z") : null,
      recoveredOrderId: null,
      createdAt: baseDate,
    });
    await repo.save(attempt);
  }

  const useCase = new GetRecoveryMetricsUseCase(repo);
  const metrics = await useCase.execute({
    merchantId: "mrc_1",
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-08-31T23:59:59.999Z"),
  });

  assert.equal(metrics.recovery_attempts, 3);
  assert.equal(metrics.recovered, 1);
  assert.ok(metrics.recovery_rate !== null && metrics.recovery_rate > 0);
  assert.equal(metrics.top_strategy, "escalate_discount");
});

test("UC-19b — GetRecoveryMetrics: different merchant → not counted", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const baseDate = new Date("2026-08-15T10:00:00.000Z");

  await repo.save(new RecoveryAttempt({
    id: "rec_m2",
    merchantId: "mrc_2",
    sessionId: "ses_m2",
    globalUserId: "usr_m2",
    abandonmentReason: "price",
    abandonmentScore: 0.6,
    strategy: { type: "escalate_discount", value_percent: 10, cap: 10 },
    channel: "in_session",
    sentAt: baseDate,
    status: "recovered",
    recoveredAt: baseDate,
    recoveredOrderId: null,
    createdAt: baseDate,
  }));

  const useCase = new GetRecoveryMetricsUseCase(repo);
  const metrics = await useCase.execute({
    merchantId: "mrc_1",
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-08-31T23:59:59.999Z"),
  });

  assert.equal(metrics.recovery_attempts, 0);
  assert.equal(metrics.recovered, 0);
});

// --- Channel selection ---

test("an attempt without a delivery route has no selected external channel", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const useCase = new AttemptCartRecoveryUseCase(repo, fixedClock);

  await useCase.execute({
    merchantId: "mrc_1",
    sessionId: "ses_ch1",
    globalUserId: "usr_1",
    abandonmentScore: 0.6,
    events: ["shipping_objection_detected"],
    buyerHistory: defaultBuyerHistory(),
    merchantRules: defaultMerchantRules(),
  });

  const attempt = repo.getAll()[0]!;
  assert.equal(attempt.channel, "none");
});
