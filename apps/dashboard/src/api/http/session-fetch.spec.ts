import { describe, expect, it } from "vitest";
import { createDashboardApi } from "../index.js";
import { createSessionFetch } from "./session-fetch.js";
import { dashboardFetch } from "./client.js";

describe("session authentication without cookies", () => {
  it("authenticates the owner and store writes immediately after registration", async () => {
    const calls: string[] = [];
    const api = createDashboardApi({ baseUrl: "https://api.test", fetchImpl: (async (input, init) => {
      const url = String(input);
      calls.push(url);
      const bearer = new Headers(init?.headers).get("Authorization");
      if (url.endsWith("/auth/register")) {
        expect(bearer).toBeNull();
        return Response.json({ access_token: "test-session" });
      }
      return bearer === "Bearer test-session" ? Response.json({}) : Response.json({ code: "missing_bearer_token" }, { status: 401 });
    }) as typeof fetch });
    await api.register({ merchant_name: "Test", email: "test@example.test", password: "Test123456" });
    await api.updateMe({ name: "Test", phone: "11999999999" });
    await api.putStoreSettings({ registration_pending: true });
    expect(calls).toHaveLength(3);
  });

  it("clears the token at logout and never sends it to another origin", async () => {
    const headers: (string | null)[] = [];
    const f = createSessionFetch("https://api.test", (async (_input, init) => {
      headers.push(new Headers(init?.headers).get("Authorization"));
      return Response.json({ access_token: "test-session" });
    }) as typeof fetch);
    await f("https://api.test/v1/auth/login");
    await f("https://other.test/v1/auth/me");
    await f("https://api.test/v1/auth/me");
    await f("https://api.test/v1/auth/logout");
    await f("https://api.test/v1/auth/me");
    expect(headers).toEqual([null, null, "Bearer test-session", "Bearer test-session", null]);
  });

  it("shares the session across clients and HTTP calls and replaces tokens after refresh", async () => {
    const seen: (string | null)[] = [];
    const impl = (async (input, init) => {
      seen.push(new Headers(init?.headers).get("Authorization"));
      return Response.json({ access_token: String(input).endsWith("refresh") ? "renewed" : "initial" });
    }) as typeof fetch;
    const f = createSessionFetch("https://api.test/v1", impl);
    const other = createSessionFetch("https://api.test/v1", impl);
    await f("https://api.test/v1/auth/oauth/callback");
    await other("https://api.test/v1/auth/me");
    await dashboardFetch("https://api.test", "/dashboard/nav-counts", {}, impl);
    await f("https://api.test/v1/auth/refresh");
    await f("https://api.test/v1/auth/me");
    expect(seen).toEqual([null, "Bearer initial", "Bearer initial", "Bearer initial", "Bearer renewed"]);
  });

  it("does not share tokens between API origins or independent fetch transports", async () => {
    const seen: (string | null)[] = [];
    const impl = (async (_input, init) => {
      seen.push(new Headers(init?.headers).get("Authorization"));
      return Response.json({ access_token: "session" });
    }) as typeof fetch;
    await createSessionFetch("https://api.test", impl)("https://api.test/v1/auth/login");
    await createSessionFetch("https://other.test", impl)("https://other.test/v1/auth/me");
    await createSessionFetch("https://api.test", ((...args) => impl(...args)) as typeof fetch)("https://api.test/v1/auth/me");
    expect(seen).toEqual([null, null, null]);
  });

  it("refreshes with the bearer and retries a background request with the new token", async () => {
    const requests: { path: string; bearer: string | null }[] = [];
    const impl = (async (input, init) => {
      const path = new URL(String(input)).pathname;
      const bearer = new Headers(init?.headers).get("Authorization");
      requests.push({ path, bearer });
      if (path.endsWith("/login")) return Response.json({ access_token: "expired" });
      if (path.endsWith("/refresh")) {
        expect(bearer).toBe("Bearer expired");
        return Response.json({ access_token: "renewed" });
      }
      return bearer === "Bearer renewed" ? Response.json({}) : Response.json({}, { status: 401 });
    }) as typeof fetch;
    const api = createDashboardApi({ baseUrl: "https://api.test", fetchImpl: impl });
    await api.login("test@example.test", "Test123456");
    const response = await dashboardFetch("https://api.test", "/dashboard/nav-counts", {}, impl);
    expect(response.status).toBe(200);
    expect(requests.map(request => request.bearer)).toEqual([null, "Bearer expired", "Bearer expired", "Bearer renewed"]);
  });
});
