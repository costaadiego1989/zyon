import { describe, expect, it } from "vitest";
import { DashboardHttpError } from "../../../api/http/error.js";
import { SupportRefreshCoordinator, supportRefreshError } from "./support-refresh.js";

describe("Support refresh scheduling", () => {
  it("coalesces overlapping focus, websocket and poll requests", async () => {
    const coordinator = new SupportRefreshCoordinator(() => 0);
    let calls = 0, finish!: (value: string) => void;
    const load = () => { calls++; return new Promise<string>(resolve => { finish = resolve; }); };
    const first = coordinator.run("case:1", load), second = coordinator.run("case:1", load);
    await Promise.resolve(); expect(calls).toBe(1); expect(first).toBe(second);
    finish("conversation"); expect(await first).toEqual({ kind: "success", data: "conversation" });
  });
  it("shares Retry-After across conversation, tickets and read acknowledgements", async () => {
    let now = 0, calls = 0; const coordinator = new SupportRefreshCoordinator(() => now);
    const load = async () => { calls++; return "data"; };
    await coordinator.run("case:1", async () => { throw new DashboardHttpError(429, "", 90); });
    for (const key of ["case:1", "tickets:all", "read:1"]) expect(await coordinator.run(key, load)).toEqual({ kind: "paused", retryAt: 90000 });
    now = 89999; await coordinator.run("case:1", load); expect(calls).toBe(0);
    now = 90000; expect((await coordinator.run("case:1", load)).kind).toBe("success"); expect(calls).toBe(1);
  });
  it("waits 60 seconds when a gateway 429 omits Retry-After", async () => {
    const coordinator = new SupportRefreshCoordinator(() => 100);
    const result = await coordinator.run("case", async () => { throw new DashboardHttpError(429, ""); });
    expect(result.kind).toBe("error"); expect("retryAt" in result && result.retryAt).toBe(60100);
  });
  it("backs off transient failures and recovers after success", async () => {
    let now = 0; const coordinator = new SupportRefreshCoordinator(() => now);
    const fail = async () => { throw new Error("network"); };
    await coordinator.run("case", fail); now = 15000;
    const second = await coordinator.run("case", fail); expect("retryAt" in second && second.retryAt).toBe(45000);
    now = 45000; expect((await coordinator.run("case", async () => "ok")).kind).toBe("success");
    now = 46000; const reset = await coordinator.run("case", fail); expect("retryAt" in reset && reset.retryAt).toBe(61000);
  });
  it("keeps quota pauses independent between authenticated API clients", async () => {
    const first = new SupportRefreshCoordinator(() => 0), second = new SupportRefreshCoordinator(() => 0);
    await first.run("case", async () => { throw new DashboardHttpError(429, "", 10); });
    expect((await second.run("case", async () => "another-store")).kind).toBe("success");
    expect(supportRefreshError(new DashboardHttpError(429, "", 10))).not.toContain("dashboard_http_429");
  });
});
