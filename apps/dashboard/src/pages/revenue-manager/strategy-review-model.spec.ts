import { describe, expect, it } from "vitest";
import type { StrategyReview, StrategyVersion } from "../../api/endpoints/strategy-review.js";
import { DashboardHttpError } from "../../api/http/error.js";
import { canReviewVersion, decisionMayHaveSucceeded, reviewErrorMessage } from "./strategy-review-model.js";
import { strategyIdFromHash, strategyReviewHash } from "./strategy-review.js";

const version = { version: 1, proposalHash: "a".repeat(64), expiresAt: "2099-01-01T00:00:00Z",
  proposal: { definition: "checkout-strategy-review-v1" } } as StrategyVersion;
const review = { status: "pending_review", currentVersion: 1, versions: [version] } as StrategyReview;
describe("strategy review decision boundaries", () => {
  it("blocks a historical version even when the current proposal awaits review", () => {
    expect(canReviewVersion(review, version)).toBe(true);
    expect(canReviewVersion({ ...review, currentVersion: 2 }, version)).toBe(false);
    expect(canReviewVersion(review, { ...version, proposalHash: "b".repeat(64) })).toBe(false);
  });
  it.each(["revision_pending", "rejected", "approved", "active"])("blocks decisions in %s", status => {
    expect(canReviewVersion({ ...review, status }, version)).toBe(false);
  });
  it("blocks communication decisions once an incentive test has been funded", () => {
    expect(canReviewVersion({ ...review, decision_available: false }, version)).toBe(false);
  });
  it("keeps expired proposals rejectable but rejects malformed contracts", () => {
    expect(canReviewVersion(review, { ...version, expiresAt: "2000-01-01T00:00:00Z" })).toBe(true);
    expect(canReviewVersion(review, { ...version, expiresAt: "invalid" })).toBe(false);
    expect(canReviewVersion(review, { ...version, proposal: { definition: "unknown" } as never })).toBe(false);
  });
  it("distinguishes an uncertain response from a rejected decision", () => {
    expect(decisionMayHaveSucceeded(new DashboardHttpError(503, ""))).toBe(true);
    expect(decisionMayHaveSucceeded(new DashboardHttpError(0, ""))).toBe(true);
    expect(decisionMayHaveSucceeded(new Error("Invalid receipt"))).toBe(true);
    expect(decisionMayHaveSucceeded(new DashboardHttpError(409, ""))).toBe(false);
    expect(reviewErrorMessage(new DashboardHttpError(409, '{"message":"STRATEGY_VERSION_CONFLICT"}'))).toContain("A proposta mudou");
  });
  it("encodes direct links without allowing query characters to change the destination", () => {
    const id = "id/?#&=ção";
    expect(strategyIdFromHash(`#${strategyReviewHash(id)}`)).toBe(id);
    expect(strategyIdFromHash("#overview?strategy=id")).toBe(null);
    expect(strategyIdFromHash("#revenue-manager?strategy=")).toBe(null);
    expect(strategyIdFromHash(`#${strategyReviewHash("a".repeat(151))}`)).toBe(null);
  });
});
