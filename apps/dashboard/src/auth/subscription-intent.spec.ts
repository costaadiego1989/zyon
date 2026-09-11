import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSubscriptionIntent, readSubscriptionIntent, rememberSubscriptionPlan } from "./subscription-intent.js";

describe("subscription entry intent", () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    vi.stubGlobal("window", { location: { search: "" } });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("keeps the selected plan across OAuth and the checkout return without storing credentials", () => {
    window.location.search = "?mode=signup&plan=scale";
    expect(readSubscriptionIntent()).toBe("scale");
    window.location.search = "?code=oauth-code&state=random";
    expect(readSubscriptionIntent()).toBe("scale");
    window.location.search = "?billing=success";
    expect(readSubscriptionIntent()).toBe("scale");
    expect([...values.values()][0]).not.toContain("oauth-code");
    clearSubscriptionIntent();
    expect(readSubscriptionIntent()).toBeNull();
  });
  it("rejects arbitrary URLs and unknown plans even with an old saved choice", () => {
    rememberSubscriptionPlan("growth");
    window.location.search = "?plan=https://example.com";
    expect(readSubscriptionIntent()).toBeNull();
  });
  it("expires unfinished choices instead of unexpectedly reopening an old purchase", () => {
    vi.useFakeTimers();
    rememberSubscriptionPlan("growth");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(readSubscriptionIntent()).toBeNull();
  });
  it("survives corrupt and unavailable storage", () => {
    values.set("zyon_subscription_intent", "{broken");
    expect(readSubscriptionIntent()).toBeNull();
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("disabled"); }, setItem: () => { throw new Error("disabled"); }, removeItem: () => { throw new Error("disabled"); } });
    window.location.search = "?plan=starter";
    expect(readSubscriptionIntent()).toBe("starter");
    expect(() => clearSubscriptionIntent()).not.toThrow();
  });
});
