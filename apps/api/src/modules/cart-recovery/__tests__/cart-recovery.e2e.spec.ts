import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { AttemptCartRecoveryUseCase, type Clock } from "../application/use-cases/attempt-cart-recovery.use-case.js";
import { TrackRecoveryOutcomeUseCase } from "../application/use-cases/track-recovery-outcome.use-case.js";
import { GetRecoveryMetricsUseCase } from "../application/use-cases/get-recovery-metrics.use-case.js";
import { RecoveryAttempt } from "../domain/entities/recovery-attempt.entity.js";

/**
 * E2E Golden Path: simulates the full cart-recovery lifecycle.
 *
 * Flow:
 * 1. Session abandons with coupon_field_clicked → score >= 0.55
 * 2. Scanner tick → AttemptCartRecovery → 1 attempt written
 * 3. Attempt is marked as sent
 * 4. Session reactivates at sent_at + 2h → outcome tracker → recovered
 * 5. GetRecoveryMetrics → recovery_rate > 0, top_strategy = 'escalate_discount'
 */

const BASE_TIME = new Date("2026-08-20T10:00:00.000Z");

function createClock(time: Date): Clock {
  return { now: () => time };
}

test("E2E-20 — Full flow: session abandons → strategy selected → attempt stored", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const clock = createClock(BASE_TIME);
  const attemptUseCase = new AttemptCartRecoveryUseCase(repo, clock);

  // Step 1: Scanner picks up session with high abandonment score and coupon event
  const result = await attemptUseCase.execute({
    merchantId: "mrc_e2e",
    sessionId: "ses_e2e_1",
    globalUserId: "usr_e2e_1",
    abandonmentScore: 0.6,
    events: ["page_viewed", "coupon_field_clicked"],
    buyerHistory: {
      known_buyer: false,
      discount_sensitivity: "high",
      recent_skus: [],
    },
    merchantRules: {
      allowFreeShipping: true,
      maxDiscountPercent: 10,
    },
  });

  assert.equal(result.created, true);
  assert.ok(result.attemptId);

  // Verify strategy selected correctly (price + high sensitivity → escalate_discount)
  const attempt = repo.getAll()[0]!;
  assert.equal(attempt.strategy.type, "escalate_discount");
  assert.equal(attempt.channel, "none");
  assert.equal(attempt.status, "pending");
  assert.equal(attempt.merchantId, "mrc_e2e");
});

test("E2E-21 — Recovery success: attempt sent → session reactivates → outcome tracked", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const clock = createClock(BASE_TIME);
  const attemptUseCase = new AttemptCartRecoveryUseCase(repo, clock);

  // Step 1: Create and store attempt
  const { attemptId } = await attemptUseCase.execute({
    merchantId: "mrc_e2e",
    sessionId: "ses_e2e_2",
    globalUserId: "usr_e2e_2",
    abandonmentScore: 0.6,
    events: ["coupon_field_clicked"],
    buyerHistory: {
      known_buyer: false,
      discount_sensitivity: "high",
      recent_skus: [],
    },
    merchantRules: {
      allowFreeShipping: false,
      maxDiscountPercent: 10,
    },
  });

  // Step 2: Mark attempt as sent (simulating scanner push)
  const stored = await repo.findById(attemptId!);
  assert.ok(stored);
  const sentAttempt = stored.markSent(BASE_TIME);
  await repo.save(sentAttempt);

  // Step 3: Session reactivates 2h later → outcome tracker marks recovered
  const reactivationTime = new Date(BASE_TIME.getTime() + 2 * 60 * 60 * 1000);
  const outcomeUseCase = new TrackRecoveryOutcomeUseCase(repo, createClock(reactivationTime));
  const outcome = await outcomeUseCase.execute({
    merchantId: "mrc_e2e",
    sessionId: "ses_e2e_2",
    reactivatedAt: reactivationTime,
    orderId: "ord_e2e_1",
  });

  assert.equal(outcome.status, "recovered");
  assert.equal(outcome.attemptId, attemptId);

  // Step 4: Verify via metrics
  const metricsUseCase = new GetRecoveryMetricsUseCase(repo);
  const metrics = await metricsUseCase.execute({
    merchantId: "mrc_e2e",
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-08-31T23:59:59.999Z"),
  });

  assert.ok(metrics.recovery_rate !== null && metrics.recovery_rate > 0);
  assert.equal(metrics.recovered, 1);
  assert.equal(metrics.top_strategy, "escalate_discount");
});

test("E2E — Scanner idempotency: same session not double-processed", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const clock = createClock(BASE_TIME);
  const attemptUseCase = new AttemptCartRecoveryUseCase(repo, clock);

  const input = {
    merchantId: "mrc_e2e",
    sessionId: "ses_e2e_idem",
    globalUserId: "usr_e2e_idem",
    abandonmentScore: 0.6,
    events: ["shipping_objection_detected"],
    buyerHistory: {
      known_buyer: false,
      discount_sensitivity: "low" as const,
      recent_skus: [],
    },
    merchantRules: {
      allowFreeShipping: true,
      maxDiscountPercent: 10,
    },
  };

  // Fire scanner 5 times (simulating BullMQ retries)
  for (let i = 0; i < 5; i++) {
    await attemptUseCase.execute(input);
  }

  // Only 1 attempt created
  assert.equal(repo.count(), 1);
});

test("E2E — Multi-merchant isolation: M1 attempts don't appear in M2 metrics", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  const clock = createClock(BASE_TIME);
  const attemptUseCase = new AttemptCartRecoveryUseCase(repo, clock);

  // M1 gets an attempt
  await attemptUseCase.execute({
    merchantId: "mrc_m1",
    sessionId: "ses_m1",
    globalUserId: "usr_m1",
    abandonmentScore: 0.6,
    events: ["shipping_objection_detected"],
    buyerHistory: { known_buyer: false, discount_sensitivity: "low", recent_skus: [] },
    merchantRules: { allowFreeShipping: true, maxDiscountPercent: 10 },
  });

  // M2 gets an attempt
  await attemptUseCase.execute({
    merchantId: "mrc_m2",
    sessionId: "ses_m2",
    globalUserId: "usr_m2",
    abandonmentScore: 0.6,
    events: ["coupon_field_clicked"],
    buyerHistory: { known_buyer: false, discount_sensitivity: "high", recent_skus: [] },
    merchantRules: { allowFreeShipping: false, maxDiscountPercent: 10 },
  });

  const metricsUseCase = new GetRecoveryMetricsUseCase(repo);

  const m1Metrics = await metricsUseCase.execute({
    merchantId: "mrc_m1",
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-08-31T23:59:59.999Z"),
  });

  const m2Metrics = await metricsUseCase.execute({
    merchantId: "mrc_m2",
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-08-31T23:59:59.999Z"),
  });

  assert.equal(m1Metrics.recovery_attempts, 1);
  assert.equal(m2Metrics.recovery_attempts, 1);
  assert.equal(m1Metrics.top_strategy, "offer_free_shipping");
  assert.equal(m2Metrics.top_strategy, "escalate_discount");
});
