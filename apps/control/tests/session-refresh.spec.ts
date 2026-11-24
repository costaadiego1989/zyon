import { afterEach, expect, it, vi } from "vitest";
import { PlatformApi, PlatformApiError } from "../src/lib/api.js";
import { clearPlatformSession, readPlatformSession, writePlatformSession } from "../src/lib/session.js";
import { maintainPlatformSession, platformTokenExpiresAt } from "../src/lib/session-refresh.js";

const operator = { operator_id: "operator-session", email: "admin@example.test", role: "platform_admin" as const };
const auth = (token: string) => ({ ...operator, access_token: token, token_type: "Bearer" as const, expires_in: 900 });
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const bearer = (init?: RequestInit) => new Headers(init?.headers).get("Authorization");
const jwt = (expires: number) => "e30." + btoa(JSON.stringify({ exp: expires })) + ".test";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); sessionStorage.clear(); localStorage.clear(); });

it("SESSION AC1 rotates once for concurrent expiry, persists and replays old resource clients", async () => {
  writePlatformSession({ token: "expired", operator });
  const requests: { path: string; token: string | null; body?: BodyInit | null }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path = String(url); const token = bearer(init);
    requests.push({ path, token, body: init?.body });
    if (path.endsWith("/auth/refresh")) return ok(auth("replacement"), 201);
    if (token === "Bearer expired") return ok({ code: "expired" }, 401);
    return ok({ items: [], total: 7 });
  });
  const api = new PlatformApi("https://api.example.test");
  const oldClient = api.prospectingClient("expired");
  const result = await Promise.all([api.getOverview("expired"), api.getOverview("expired"), oldClient.campaigns()]);
  expect(result).toEqual([{ items: [], total: 7 }, { items: [], total: 7 }, { items: [], total: 7 }]);
  await oldClient.campaigns();
  expect(readPlatformSession()).toEqual({ token: "replacement", operator });
  expect(requests.filter(r => r.path.endsWith("/auth/refresh"))).toEqual([
    { path: "https://api.example.test/v1/platform/auth/refresh", token: "Bearer expired", body: undefined },
  ]);
  expect(requests.at(-1)?.token).toBe("Bearer replacement");
  expect(requests.filter(r => !r.path.endsWith("/auth/refresh") && r.token === "Bearer replacement")).toHaveLength(4);
});

it("SESSION AC1 replays an idempotent command with the same payload and key", async () => {
  writePlatformSession({ token: "expired", operator });
  const writes: RequestInit[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).endsWith("/auth/refresh")) return ok(auth("replacement"), 201);
    writes.push(init!);
    return bearer(init) === "Bearer expired" ? ok({}, 401) : ok({ id: "draft-1", name: "Retail" });
  });
  const command = { name: "Retail", clientRequestId: "same-request-id" };
  const result = await new PlatformApi("https://api.example.test").prospectingClient("expired").createDraft(command);
  expect(result).toEqual({ id: "draft-1", name: "Retail" });
  expect(writes.map(w => ({ method: w.method, body: JSON.parse(String(w.body)), key: new Headers(w.headers).get("Idempotency-Key") })))
    .toEqual([0, 1].map(() => ({ method: "POST", body: command, key: "same-request-id" })));
});

it("SESSION AC2 retains credentials after temporary refresh failure", async () => {
  writePlatformSession({ token: "expired", operator });
  vi.spyOn(globalThis, "fetch").mockImplementation(async url =>
    String(url).endsWith("/auth/refresh") ? ok({ code: "unavailable" }, 503) : ok({}, 401));
  await expect(new PlatformApi("https://api.example.test").getOverview("expired")).rejects.toMatchObject({ status: 503 });
  expect(readPlatformSession()).toEqual({ token: "expired", operator });
});

it("SESSION AC2 clears a server-rejected renewal without retrying indefinitely", async () => {
  writePlatformSession({ token: "revoked", operator });
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok({ code: "invalid_session" }, 401));
  await expect(new PlatformApi("https://api.example.test").getOverview("revoked")).rejects.toBeInstanceOf(PlatformApiError);
  expect(readPlatformSession()).toBeNull();
  expect(transport).toHaveBeenCalledTimes(2);
});

it("SESSION AC2 logout fences a pending rotation and revokes the latest credential", async () => {
  writePlatformSession({ token: "expired", operator });
  let complete!: (r: Response) => void;
  const observed: { path: string; token: string | null }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path = String(url); observed.push({ path, token: bearer(init) });
    if (path.endsWith("/refresh")) return new Promise<Response>(resolve => { complete = resolve; });
    return new Response(null, { status: 204 });
  });
  const api = new PlatformApi("https://api.example.test");
  const pending = api.refreshSession("expired");
  const rejection = expect(pending).rejects.toThrow("platform_session_changed");
  await api.logout("expired"); clearPlatformSession(); complete(ok(auth("late-replacement"), 201));
  await rejection;
  expect(readPlatformSession()).toBeNull();
  expect(observed.at(-1)).toEqual({ path: "https://api.example.test/v1/platform/auth/logout", token: "Bearer expired" });
});

it("SESSION AC2 logout fences renewal while the revoke HTTP request is still pending", async () => {
  writePlatformSession({ token: "expired", operator });
  let completeRefresh!: (response: Response) => void;
  let completeLogout!: (response: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(async url => new Promise<Response>(resolve => {
    if (String(url).endsWith("/refresh")) completeRefresh = resolve;
    else if (String(url).endsWith("/logout")) completeLogout = resolve;
    else throw Error("unexpected request");
  }));
  const api = new PlatformApi("https://api.example.test");
  const renewal = api.refreshSession("expired");
  const rejected = expect(renewal).rejects.toThrow("platform_session_changed");
  const logout = api.logout("expired");
  completeRefresh(ok(auth("late-replacement"), 201));
  await rejected;
  expect(readPlatformSession()).toEqual({ token: "expired", operator });
  completeLogout(new Response(null, { status: 204 }));
  await logout; clearPlatformSession();
  expect(readPlatformSession()).toBeNull();
});

it("SESSION AC2 does not treat forbidden resource access as token expiry", async () => {
  writePlatformSession({ token: "valid", operator });
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ code: "forbidden" }, 403));
  await expect(new PlatformApi("https://api.example.test").getOverview("valid")).rejects.toMatchObject({ status: 403 });
  expect(readPlatformSession()?.token).toBe("valid");
  expect(transport).toHaveBeenCalledTimes(1);
});

it("SESSION AC3 renews before expiry using sessionStorage without cookie or persistent token", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-24T17:00:00Z"));
  const token = jwt(Math.floor(Date.now() / 1000) + 120);
  const replacement = jwt(Math.floor(Date.now() / 1000) + 1020);
  writePlatformSession({ token, operator });
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(auth(replacement), 201));
  const api = new PlatformApi("https://api.example.test");
  const fail = vi.fn();
  const stop = maintainPlatformSession(token, value => api.refreshSession(value), fail);
  await vi.advanceTimersByTimeAsync(59_999); expect(transport).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(readPlatformSession()).toEqual({ token: replacement, operator });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(fail).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0); expect(document.cookie).toBe("");
  expect(platformTokenExpiresAt(replacement)).toBe(Date.parse("2026-11-24T17:17:00Z"));
  stop();
});

it("SESSION AC3 rechecks an overdue session when the operator returns to the tab", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-24T17:00:00Z"));
  const token = jwt(Math.floor(Date.now() / 1000) + 900);
  writePlatformSession({ token, operator });
  const renew = vi.fn().mockResolvedValue("fresh");
  const stop = maintainPlatformSession(token, renew, vi.fn());
  vi.setSystemTime(new Date("2026-11-24T17:16:00Z"));
  window.dispatchEvent(new Event("focus")); await Promise.resolve(); await Promise.resolve();
  expect(renew).toHaveBeenCalledExactlyOnceWith(token); stop();
});
