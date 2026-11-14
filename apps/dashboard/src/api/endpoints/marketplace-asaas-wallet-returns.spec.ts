import { describe, expect, it } from "vitest";
import { marketplaceAsaasWalletReturnEndpoints, type AsaasWalletReturnEntry, type AsaasWalletReturnJournal } from "./marketplace-asaas-wallet-returns.js";
import { createSessionFetch } from "../http/session-fetch.js";

const base = "https://dashboard-fixture.invalid";
const hash = "a".repeat(64);
const claimed: AsaasWalletReturnJournal = { id: "journal_one", refund_id: "refund_one", payout_id: "payout_one", amount_cents: 8500,
  currency: "BRL", request_hash: hash, status: "claimed", can_execute: true, certificate_hash: null };
const entry: AsaasWalletReturnEntry = { refund_id: claimed.refund_id, payout_id: claimed.payout_id, return_id: "return_one",
  created_at: "2026-10-03T00:00:00.000Z", host_name: "Loja anfitriã", amount_cents: 8500, currency: "BRL", environment: "test", payment_method: "pix", journal: null };
function fixture(value: unknown, status = 200, lost = false) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (lost) throw Error("timeout");
    return new Response(JSON.stringify(value), { status });
  };
  return { calls, api: marketplaceAsaasWalletReturnEndpoints(base, transport), transport };
}
describe("Asaas wallet return dashboard transport", () => {
  it("discovers candidates and existing journals by GET with bounded cursor pagination", async () => {
    const f = fixture({ entries: [entry, { ...entry, refund_id: "refund_two", payout_id: "payout_two", journal: { ...claimed, refund_id: "refund_two", payout_id: "payout_two" } }], next_cursor: "cursor_fixture" });
    expect((await f.api.listMarketplaceAsaasWalletReturns("previous_cursor")).entries).toHaveLength(2);
    expect(f.calls[0].url).toContain("?limit=20&cursor=previous_cursor"); expect(f.calls[0].init?.method).toBe("GET");
  });
  it("preview does not approve or execute", async () => {
    const f = fixture({ ...claimed, status: "awaiting_consent", can_execute: false });
    expect((await f.api.previewMarketplaceAsaasWalletReturn("refund_one", "payout_one")).status).toBe("awaiting_consent");
    expect(f.calls).toHaveLength(1); expect(f.calls[0].init?.method).toBe("GET");
  });
  it("approval and execution carry only confirmed frozen financial preconditions", async () => {
    const f = fixture(claimed); await f.api.approveMarketplaceAsaasWalletReturn("refund_one", "payout_one", 8500);
    await f.api.executeMarketplaceAsaasWalletReturn("journal_one", 8500, hash);
    expect(f.calls.map(call => JSON.parse(String(call.init?.body)))).toEqual([
      { confirmed: true, expected_amount_cents: 8500 }, { confirmed: true, expected_amount_cents: 8500, expected_request_hash: hash }]);
    expect(f.calls.every(call => call.init?.credentials === "include" && call.init?.redirect === "error" && !!call.init?.signal)).toBe(true);
  });
  for (const status of [400, 401, 409, 500]) it(`financial POST ${status} does not refresh authentication or retry`, async () => {
    const f = fixture({ private_provider_token: "not_for_display" }, status);
    await expect(f.api.executeMarketplaceAsaasWalletReturn("journal_one", 8500, hash)).rejects.toThrow(`dashboard_http_${status}`);
    expect(f.calls).toHaveLength(1); expect(f.calls[0].url).toContain("/execute");
  });
  it("lost response never schedules another POST", async () => {
    const f = fixture({}, 200, true);
    await expect(f.api.executeMarketplaceAsaasWalletReturn("journal_one", 8500, hash)).rejects.toThrow("timeout"); expect(f.calls).toHaveLength(1);
  });
  it("shares the returned bearer session without introducing financial auth retries", async () => {
    const calls: RequestInit[] = [];
    const transport: typeof fetch = async (url, init) => {
      calls.push(init!);
      return new Response(JSON.stringify(String(url).endsWith("/auth/login") ? { access_token: "synthetic_session_fixture" } : claimed));
    };
    await createSessionFetch(base, transport)(`${base}/v1/auth/login`, { method: "POST" });
    await marketplaceAsaasWalletReturnEndpoints(base, transport).executeMarketplaceAsaasWalletReturn("journal_one", 8500, hash);
    expect(new Headers(calls[1].headers).get("Authorization")).toBe("Bearer synthetic_session_fixture"); expect(calls).toHaveLength(2);
  });
  it("independent refresh uses GET and requires a matching journal identity", async () => {
    const f = fixture({ ...claimed, id: "foreign_journal" });
    await expect(f.api.observeMarketplaceAsaasWalletReturn("journal_one")).rejects.toThrow("invalid_marketplace_wallet_return_observation");
    expect(f.calls[0].init?.method).toBe("GET"); expect(f.calls[0].init?.body).toBeNull();
  });
  for (const invalid of [{ ...entry, amount_cents: 1.5 }, { ...entry, payment_method: "boleto" }, { ...entry, journal: { ...claimed, payout_id: "foreign_payout" } }])
    it("rejects malformed financial list rows before they can render", async () => {
      await expect(fixture({ entries: [invalid], next_cursor: null }).api.listMarketplaceAsaasWalletReturns()).rejects.toThrow("invalid_marketplace_wallet_return_list");
    });
  it("invalid command preconditions fail before any transport", async () => {
    const f = fixture(claimed);
    await expect(f.api.executeMarketplaceAsaasWalletReturn("journal_one", 8500, "bad_hash")).rejects.toThrow();
    await expect(f.api.approveMarketplaceAsaasWalletReturn("foreign/path", "payout_one", 8500)).rejects.toThrow(); expect(f.calls).toHaveLength(0);
  });
});
