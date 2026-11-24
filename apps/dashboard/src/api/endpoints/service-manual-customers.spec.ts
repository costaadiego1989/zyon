import { describe, expect, it } from "vitest";
import { serviceManualCustomerEndpoints } from "./service-manual-customers.js";

const profile = { id: "merchant-a", user_id: "owner-a" };
const row = { id: "buyer-a", profile: { fullName: "Ana", email: "ana@example.test" }, first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-01-02T00:00:00Z" };
const page = { data: [row], next_cursor: null, has_more: false };
function fixture(value: unknown = page, status = 200) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const api = serviceManualCustomerEndpoints("https://api.example.test", (async (url, init) => { requests.push({ url: String(url), init }); return Response.json(value, { status }); }) as typeof fetch);
  return { api: api.serviceManualCustomers(profile), requests };
}
describe("T79 tenant-bound existing customer transport", () => {
  it("projects only the buyer contact fields needed to choose a customer", async () => {
    const f = fixture({ ...page, data: [{ ...row, profile: { ...row.profile, phone: "21999990000", providerEvidence: "private-provider", cpf: "private-document", internalToken: "private-token" } }] });
    const result = await f.api.list();
    expect(result).toEqual({ ...page, data: [{ ...row, profile: { ...row.profile, phone: "21999990000" } }] });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("binds the captured merchant through the existing TenantGuard query and performs only GET", async () => {
    const f = fixture(); expect(await f.api.list()).toEqual(page);
    const request = f.requests[0], url = new URL(request.url); expect(url.pathname).toBe("/v1/customers");
    expect(Object.fromEntries(url.searchParams)).toEqual({ merchantId: profile.id, limit: "25" }); expect(request.init?.method).toBe("GET"); expect(request.init?.body).toBeNull();
  });
  it("retains the current signal and exact opaque pagination cursor", async () => {
    const f = fixture(), controller = new AbortController(); await f.api.list({ cursor: "opaque_page", signal: controller.signal });
    expect(new URL(f.requests[0].url).searchParams.get("cursor")).toBe("opaque_page"); expect(f.requests[0].init?.signal).toBe(controller.signal);
  });
  it.each([null, { id: "foreign", user_id: "" }, { id: "..", user_id: "owner" }])("rejects an invalid captured profile before dispatch %j", value => {
    let requests = 0; const api = serviceManualCustomerEndpoints("https://api.example.test", (async () => { requests++; return Response.json(page); }) as typeof fetch);
    expect(() => api.serviceManualCustomers(value as typeof profile)).toThrow(); expect(requests).toBe(0);
  });
  it.each([{ data: "invalid", next_cursor: null, has_more: false }, { data: [row, row], next_cursor: null, has_more: false },
    { data: [{ ...row, profile: "private" }], next_cursor: null, has_more: false }, { data: [], next_cursor: "same", has_more: false }])("refuses a malformed page without fabricating an empty customer list %j", async value => {
    const f = fixture(value); await expect(f.api.list()).rejects.toThrow(); expect(f.requests).toHaveLength(1);
  });
  it("preserves an actual foreign-tenant denial instead of turning it into an empty list", async () => {
    const f = fixture({ code: "tenant_mismatch_query" }, 403); await expect(f.api.list()).rejects.toMatchObject({ status: 403 }); expect(f.requests).toHaveLength(1);
  });
});
