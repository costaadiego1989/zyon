import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SANDBOX_LLM_APPROVAL } from "./storefront-sandbox-llm-budget.mjs";
import { parseOriginalJourneyBudgetEvidence, createOriginalApprovedJourneyBudget } from "./storefront-journey-original-budget.mjs";
import * as budgetAudit from "./storefront-journey-original-budget.mjs";

// Parser-only synthetic data. Never reads/writes the actual approved ledger.
const manifest = { ...SANDBOX_LLM_APPROVAL, synthetic: false, createdAt: "2026-10-18T12:00:00.000Z" };
const row = number => ({ version: 1, callNumber: number, stepId: randomUUID(), stage: "turn", maxTokens: 1024, at: "2026-10-20T12:00:00.000Z" });
test("original approval parser preserves consumed12 and remaining48, no reset", () => {
  const text = Array.from({ length: 12 }, (_, index) => JSON.stringify(row(index + 1))).join("\n") + "\n";
  const status = parseOriginalJourneyBudgetEvidence(manifest, text);
  assert.equal(status.attemptedCalls, 12); assert.equal(status.remainingCalls, 48); assert.equal(status.synthetic, false);
});
for (const changed of [{ synthetic: true }, { maximumCalls: 61 }, { maximumOutputTokensPerCall: 2048 }, { retries: true }, { approvalId: "new-approval" }]) {
  test(`reject copied synthetic or expanded approval: ${JSON.stringify(changed)}`, () => {
    assert.throws(() => parseOriginalJourneyBudgetEvidence({ ...manifest, ...changed }, ""));
  });
}
test("corrupt/noncontiguous/replayed/truncated attempts refuse instead of resetting", () => {
  const first = row(1), second = row(2);
  for (const text of ["{broken}\n", JSON.stringify(first), JSON.stringify(second) + "\n",
    JSON.stringify(first) + "\n" + JSON.stringify({ ...second, stepId: first.stepId }) + "\n",
    JSON.stringify({ ...first, maxTokens: 1025 }) + "\n"])
    assert.throws(() => parseOriginalJourneyBudgetEvidence(manifest, text));
});
test("factory refuses missing approval before old-path I/O or any provider call", async () => {
  await assert.rejects(createOriginalApprovedJourneyBudget({}), /journey_explicit_original_approval_required/);
  await assert.rejects(createOriginalApprovedJourneyBudget({ allowRealDeepSeek: true, approvalId: SANDBOX_LLM_APPROVAL.approvalId, directory: "copied" }), /journey_explicit_original_approval_required/);
});

test("unpaid commerce audit names90 explicitly without granting a provider or initializing a budget", () => {
  const required = ["--commerce-only", "--no-real-provider"];
  assert.deepEqual(budgetAudit.parseJourneyBudgetAuditFlags(required, required), undefined);
  assert.deepEqual(budgetAudit.parseJourneyBudgetAuditFlags([...required, "--budget-approval-id=storefront-sandbox-20261021-approved90"], required),
    { approvalId: "storefront-sandbox-20261021-approved90" });
  for (const extra of [["--budget-approval-id=foreign"], ["--allow-real-deepseek"], ["--extend-original-budget-to=90"],
    ["--budget-approval-id=storefront-sandbox-20261021-approved90", "--budget-approval-id=storefront-sandbox-20261021-approved90"]])
    assert.throws(() => budgetAudit.parseJourneyBudgetAuditFlags([...required, ...extra], required));
});
