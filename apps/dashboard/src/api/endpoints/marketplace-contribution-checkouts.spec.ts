import { describe, expect, it } from "vitest";
import { marketplaceContributionCheckoutEndpoints, type ContributionCheckoutJournal, type ContributionCandidate } from "./marketplace-contribution-checkouts.js";
import { createSessionFetch } from "../http/session-fetch.js";
const base = "https://dashboard-contribution-fixture.invalid";
const candidate: ContributionCandidate = { kind: "candidate", refund_plan_id: "refund_aurora", environment: "test", required_net_cents: 99,
  outstanding_net_cents: 99, customer_setup_required: false, can_create: true };
const approved: ContributionCheckoutJournal = { kind: "journal", contribution_id: "contribution_aurora", refund_plan_id: "refund_aurora", environment: "test",
  status: "approved", gross_amount_cents: 500, maximum_credit_cents: 99, credited_net_cents: 0, processing_fee_cents: 0, excess_liability_cents: 0,
  returned_excess_cents: 0, request_hash: "a".repeat(64), can_create: false, can_return_excess: false, can_cancel: true, currency: "BRL",
  collection_mode: "hosted_checkout", processing_fee_known: false };
const credited: ContributionCheckoutJournal = { ...approved, status: "credited", can_cancel: false, processing_fee_known: true,
  credited_net_cents: 99, processing_fee_cents: 50, excess_liability_cents: 351, excess_status: "held", can_return_excess: true };
function fixture(value: unknown, status = 200, lost = false) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); if (lost) throw Error("timeout"); return new Response(JSON.stringify(value), { status }); };
  return { calls, api: marketplaceContributionCheckoutEndpoints(base, transport), transport };
}
describe("marketplace contribution Checkout dashboard transport", () => {
  it("lists paginated candidates and journals by local GET", async () => {
    const f = fixture({ items: [candidate, approved], next_cursor: "next_cursor" });
    expect((await f.api.listMarketplaceContributionCheckouts("prior_cursor")).items).toHaveLength(2);
    expect(f.calls[0].url).toContain("?limit=20&cursor=prior_cursor"); expect(f.calls[0].init?.method).toBe("GET");
  });
  it("context and return-URL journal lookup do not approve, create or reconcile", async () => {
    const f = fixture(candidate); await f.api.contextMarketplaceContributionCheckout(candidate.refund_plan_id);
    const g = fixture(approved); await g.api.getMarketplaceContributionCheckout(approved.contribution_id);
    expect([...f.calls, ...g.calls].every(v => v.init?.method === "GET")).toBe(true);
  });
  it("prepares only exact explicit approval fields and frozen generated ID", async () => {
    const f = fixture(approved); await f.api.prepareMarketplaceContributionCheckout("refund_aurora", "contribution_aurora", 500);
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ refund_plan_id: "refund_aurora", contribution_id: "contribution_aurora", gross_amount_cents: 500, confirmed: true });
  });
  it("creation and PSP GET-only reconcile remain separate explicit commands", async () => {
    const f = fixture({ ...approved, status: "creating", can_cancel: false }); await f.api.executeMarketplaceContributionCheckout("contribution_aurora", 500);
    await f.api.reconcileMarketplaceContributionCheckout("contribution_aurora");
    expect(f.calls.map(v => JSON.parse(String(v.init?.body)))).toEqual([{ gross_amount_cents: 500, confirmed: true }, { confirmed: true }]);
    expect(f.calls.every(v => v.init?.credentials === "include" && v.init?.redirect === "error" && !!v.init?.signal)).toBe(true);
  });
  it("cancels only an unsubmitted approval and requires a terminal receipt", async () => {
    const f = fixture({ ...approved, status: "expired", can_cancel: false }); await f.api.cancelMarketplaceContributionCheckout("contribution_aurora");
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ confirmed: true });
    await expect(fixture(approved).api.cancelMarketplaceContributionCheckout("contribution_aurora")).rejects.toThrow("invalid_marketplace_contribution_cancellation");
  });
  it("excess return uses the entire certified held amount", async () => {
    const f = fixture({ ...credited, excess_status: "unknown", can_return_excess: false }); await f.api.returnMarketplaceContributionExcess("contribution_aurora", 351);
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ amount_cents: 351, confirmed: true });
  });
  it("reads already certified paid amounts after a crash without enabling excess return", async () => {
    const f = fixture({ ...credited, status: "paid", can_return_excess: false });
    const result = await f.api.getMarketplaceContributionCheckout("contribution_aurora");
    expect(result.processing_fee_known).toBe(true); expect(result.credited_net_cents).toBe(99); expect(result.excess_liability_cents).toBe(351);
    expect(f.calls).toHaveLength(1); expect(f.calls[0].init?.method).toBe("GET");
    await expect(fixture({ ...credited, status: "paid" }).api.getMarketplaceContributionCheckout("contribution_aurora")).rejects.toThrow();
  });
  for (const status of [400, 401, 409, 500]) it(`financial POST ${status} never refreshes or retries`, async () => {
    const f = fixture({ secret_provider_payload: "PRIVATE" }, status); await expect(f.api.executeMarketplaceContributionCheckout("contribution_aurora", 500)).rejects.toThrow(`dashboard_http_${status}`);
    expect(f.calls).toHaveLength(1);
  });
  it("lost response never schedules another financial request", async () => {
    const f = fixture({}, 200, true); await expect(f.api.returnMarketplaceContributionExcess("contribution_aurora", 351)).rejects.toThrow("timeout"); expect(f.calls).toHaveLength(1);
  });
  it("shares the existing returned bearer session", async () => {
    const calls: RequestInit[] = []; const transport: typeof fetch = async (url, init) => { calls.push(init!); return new Response(JSON.stringify(String(url).endsWith("/auth/login") ? { access_token: "synthetic_fixture" } : approved)); };
    await createSessionFetch(base, transport)(`${base}/v1/auth/login`, { method: "POST" }); await marketplaceContributionCheckoutEndpoints(base, transport).executeMarketplaceContributionCheckout("contribution_aurora", 500);
    expect(new Headers(calls[1].headers).get("Authorization")).toBe("Bearer synthetic_fixture"); expect(calls).toHaveLength(2);
  });
  for (const url of ["javascript:alert(1)", "http://checkout.stripe.com/pay", "https://checkout.stripe.com.evil.invalid/pay", "https://evil.invalid/pay", "https://user@checkout.stripe.com/pay", "https://checkout.stripe.com:444/pay"])
    it("rejects an unsafe hosted payment URL", async () => { await expect(fixture({ ...approved, status: "open", can_cancel: false, checkout_url: url }).api.getMarketplaceContributionCheckout("contribution_aurora")).rejects.toThrow("invalid_marketplace_contribution_receipt"); });
  it("accepts native HTTPS Stripe Checkout only in open state", async () => {
    const url = "https://checkout.stripe.com/c/pay/cs_test_fixture#native";
    expect((await fixture({ ...approved, status: "open", can_cancel: false, checkout_url: url }).api.getMarketplaceContributionCheckout("contribution_aurora")).checkout_url).toBe(url);
    await expect(fixture({ ...approved, checkout_url: url }).api.getMarketplaceContributionCheckout("contribution_aurora")).rejects.toThrow();
  });
  it("rejects mismatched IDs, impossible credit amounts and unknown monetary values", async () => {
    for (const bad of [{ ...approved, contribution_id: "foreign" }, { ...credited, credited_net_cents: 100 }, { ...approved, gross_amount_cents: 5.2 }, { ...approved, processing_fee_known: true }])
      await expect(fixture(bad).api.getMarketplaceContributionCheckout("contribution_aurora")).rejects.toThrow("invalid_marketplace_contribution_receipt");
  });
  it("invalid command preconditions never reach transport", async () => {
    const f = fixture(approved); await expect(f.api.prepareMarketplaceContributionCheckout("refund_aurora", "foreign/path", 500)).rejects.toThrow();
    await expect(f.api.executeMarketplaceContributionCheckout("contribution_aurora", NaN)).rejects.toThrow(); expect(f.calls).toHaveLength(0);
  });
});
