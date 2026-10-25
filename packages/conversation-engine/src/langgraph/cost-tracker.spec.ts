import test from "node:test";
import assert from "node:assert/strict";
import { CostTracker, estimateTokens, PRICING } from "./cost-tracker.js";

// ─── estimateTokens ────────────────────────────────────────────────────────

test("estimateTokens approximates 4 chars per token for ASCII", () => {
  assert.equal(estimateTokens("hello world"), 3); // 11 chars -> ceil(11/4) = 3
  assert.equal(estimateTokens(""), 0);
});

test("estimateTokens never returns less than 1 for non-empty text", () => {
  assert.equal(estimateTokens("a"), 1);
});

test("estimateTokens scales with text length", () => {
  const short = estimateTokens("oi");
  const long = estimateTokens("oi ".repeat(200));
  assert.ok(long > short * 50);
});

// ─── CostTracker.record ────────────────────────────────────────────────────

test("CostTracker starts with zero usage", () => {
  const t = new CostTracker({ budgetCents: 100 });
  assert.equal(t.totalPromptTokens, 0);
  assert.equal(t.totalCompletionTokens, 0);
  assert.equal(t.totalCents(), 0);
  assert.equal(t.turnCount, 0);
});

test("CostTracker.record accumulates tokens and computes cost from PRICING", () => {
  const t = new CostTracker({ budgetCents: 1000, model: "anthropic/claude-sonnet-4" });
  t.record({ promptTokens: 1000, completionTokens: 500 });
  assert.equal(t.totalPromptTokens, 1000);
  assert.equal(t.totalCompletionTokens, 500);
  assert.equal(t.turnCount, 1);
  const expected =
    (1000 / 1000) * PRICING["anthropic/claude-sonnet-4"].promptPer1k +
    (500 / 1000) * PRICING["anthropic/claude-sonnet-4"].completionPer1k;
  assert.equal(t.totalCents(), expected);
});

test("CostTracker.record sums across multiple turns", () => {
  const t = new CostTracker({ budgetCents: 1000, model: "anthropic/claude-sonnet-4" });
  t.record({ promptTokens: 100, completionTokens: 50 });
  t.record({ promptTokens: 200, completionTokens: 80 });
  assert.equal(t.totalPromptTokens, 300);
  assert.equal(t.totalCompletionTokens, 130);
  assert.equal(t.turnCount, 2);
});

test("CostTracker.remainingCents returns budget minus spent", () => {
  const t = new CostTracker({ budgetCents: 500, model: "anthropic/claude-sonnet-4" });
  t.record({ promptTokens: 100_000, completionTokens: 50_000 });
  assert.ok(t.remainingCents() < 500);
  assert.ok(t.remainingCents() >= 0);
});

// ─── Budget enforcement ────────────────────────────────────────────────────

test("CostTracker.canAfford returns true when under budget", () => {
  const t = new CostTracker({ budgetCents: 100, model: "anthropic/claude-sonnet-4" });
  assert.equal(t.canAfford(50), true);
});

test("CostTracker.canAfford returns false when over budget", () => {
  const t = new CostTracker({ budgetCents: 100, model: "anthropic/claude-sonnet-4" });
  t.record({ promptTokens: 1_000_000, completionTokens: 1_000_000 });
  assert.equal(t.canAfford(1), false);
});

test("CostTracker.assertWithinBudget throws when exceeded", () => {
  const t = new CostTracker({ budgetCents: 1, model: "anthropic/claude-sonnet-4" });
  t.record({ promptTokens: 10_000, completionTokens: 10_000 });
  assert.throws(() => t.assertWithinBudget(), /budget_exceeded/);
});

test("CostTracker allows configuration of custom pricing", () => {
  const t = new CostTracker({
    budgetCents: 1000,
    pricing: { promptPer1k: 0.5, completionPer1k: 1.5 }
  });
  t.record({ promptTokens: 1000, completionTokens: 1000 });
  assert.equal(t.totalCents(), 2); // 0.5 + 1.5
});

test("CostTracker.snapshot returns serializable state", () => {
  const t = new CostTracker({ budgetCents: 100 });
  t.record({ promptTokens: 100, completionTokens: 50 });
  const snap = t.snapshot();
  assert.equal(snap.budgetCents, 100);
  assert.equal(snap.promptTokens, 100);
  assert.equal(snap.completionTokens, 50);
  assert.equal(typeof snap.spentCents, "number");
  assert.equal(snap.turns, 1);
});

test("CostTracker throws when budgetCents is negative", () => {
  assert.throws(() => new CostTracker({ budgetCents: -1 }), /budgetCents/);
});

test("CostTracker.fromSnapshot reconstructs state", () => {
  const a = new CostTracker({ budgetCents: 200 });
  a.record({ promptTokens: 50, completionTokens: 25 });
  const snap = a.snapshot();
  const b = CostTracker.fromSnapshot(snap);
  assert.equal(b.totalPromptTokens, 50);
  assert.equal(b.totalCompletionTokens, 25);
  assert.equal(b.turnCount, 1);
  assert.equal(b.budgetCents, 200);
});