import { describe, expect, it } from "vitest";
import { clearTerminalContributionApproval, contributionSubmissionExists, pendingContributionApproval, rememberContributionApproval,
  rememberContributionSubmission, parseContributionAmount, type ContributionStorage } from "./contribution-checkout-command-state.js";
const scope = { merchantId: "seller-a", userId: "owner-a" };
function storage(): ContributionStorage { const values = new Map<string, string>(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }; }
describe("contribution durable browser command state", () => {
  it("preserves first generated approval identity and amount before a lost response", () => {
    const s = storage(); rememberContributionApproval(s, scope, "refund_a", { id: "contribution_a", grossCents: 500 });
    expect(pendingContributionApproval(s, scope, "refund_a")).toEqual({ id: "contribution_a", grossCents: 500 });
    expect(() => rememberContributionApproval(s, scope, "refund_a", { id: "contribution_b", grossCents: 900 })).toThrow("already_submitted");
  });
  it("cannot clear pending approval on stale approved, creating or unknown states", () => {
    const s = storage(); rememberContributionApproval(s, scope, "refund_a", { id: "contribution_a", grossCents: 500 });
    for (const state of ["approved", "creating", "open", "unproven"]) clearTerminalContributionApproval(s, scope, "refund_a", "contribution_a", state);
    expect(pendingContributionApproval(s, scope, "refund_a")).not.toBeNull();
  });
  it("clears only matching certified terminal approval while retaining execution markers", () => {
    const s = storage(); rememberContributionApproval(s, scope, "refund_a", { id: "contribution_a", grossCents: 500 });
    rememberContributionSubmission(s, scope, "contribution_a", "execute");
    clearTerminalContributionApproval(s, scope, "refund_a", "foreign", "expired"); expect(pendingContributionApproval(s, scope, "refund_a")).not.toBeNull();
    clearTerminalContributionApproval(s, scope, "refund_a", "contribution_a", "credited"); expect(pendingContributionApproval(s, scope, "refund_a")).toBeNull();
    expect(contributionSubmissionExists(s, scope, "contribution_a", "execute")).toBe(true);
  });
  it("separates merchant, user, contribution and execute/excess operation markers", () => {
    const s = storage(); rememberContributionSubmission(s, scope, "contribution_a", "execute");
    expect(contributionSubmissionExists(s, scope, "contribution_a", "excess")).toBe(false);
    expect(contributionSubmissionExists(s, { ...scope, merchantId: "seller-b" }, "contribution_a", "execute")).toBe(false);
    expect(contributionSubmissionExists(s, { ...scope, userId: "owner-b" }, "contribution_a", "execute")).toBe(false);
  });
  it("fails closed if storage silently drops writes", () => {
    const s: ContributionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(() => rememberContributionSubmission(s, scope, "contribution_a", "execute")).toThrow("storage_unavailable");
    expect(() => rememberContributionApproval(s, scope, "refund_a", { id: "contribution_a", grossCents: 500 })).toThrow("storage_unavailable");
  });
  it("never treats corrupt stored approval as permission for a new POST", () => {
    const s: ContributionStorage = { getItem: () => '{"id":"foreign/path","grossCents":500}', setItem: () => {}, removeItem: () => {} };
    expect(() => pendingContributionApproval(s, scope, "refund_a")).toThrow("storage_invalid");
  });
  it("parses Brazilian currency decimals without rounding or major/minor guessing", () => {
    expect(parseContributionAmount("5,01")).toBe(501); expect(parseContributionAmount("5.1")).toBe(510); expect(parseContributionAmount("99")).toBe(9900);
    for (const v of ["1,001", "-1", "NaN", "1e3", "1.000,00", "0", "21474836,48"]) expect(parseContributionAmount(v)).toBeNull();
  });
});
