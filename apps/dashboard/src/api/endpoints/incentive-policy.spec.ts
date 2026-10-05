import { describe, expect, it, vi } from "vitest";
import { incentivePolicyMode, validIncentivePolicy, type IncentivePolicy } from "./incentive-policy.js";
import { revenueManagerEndpoints } from "./revenue-manager.js";

const initial: IncentivePolicy = { merchantId: "store", version: 0, policyHash: "a".repeat(64), mode: "automatic",
  enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 };
const funded: IncentivePolicy = { ...initial, version: 2, enabled: true, limitCents: 30000, maxDiscountCents: 1000, maxRedemptions: 30 };

describe("optional merchant incentive ceilings", () => {
  it("recognizes automatic planning before and after a specific approved budget", () => {
    for (const policy of [initial, funded]) {
      expect(validIncentivePolicy(policy, "store")).toBe(true);
      expect(incentivePolicyMode(policy)).toBe("automatic");
    }
  });
  it("preserves historical manual choices without treating them as automatic permission", () => {
    expect(incentivePolicyMode({ ...initial, mode: undefined })).toBe("automatic");
    expect(incentivePolicyMode({ ...funded, mode: undefined })).toBe("manual");
    expect(incentivePolicyMode({ ...funded, enabled: false, mode: undefined })).toBe("disabled");
  });
  it.each([
    { ...funded, mode: "future" }, { ...funded, mode: "manual", enabled: false },
    { ...funded, mode: "disabled" }, { ...funded, merchantId: "foreign" },
    { ...funded, limitCents: 1000.2 }, { ...funded, maxDiscountCents: 30001 },
  ])("rejects an unsupported or inconsistent policy projection", value => {
    expect(validIncentivePolicy(value, "store")).toBe(false);
  });
  it("resets to automatic with only the chosen mode and concurrency identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await revenueManagerEndpoints("https://api.test", fetchImpl).saveIncentivePolicy({ mode: "automatic", expectedVersion: 2,
      requestKey: "reset-mode", enabled: true, limitCents: 100000, maxDiscountCents: 10000, maxRedemptions: 10 } as never);
    const [, request] = fetchImpl.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toEqual({ mode: "automatic", expectedVersion: 2, requestKey: "reset-mode" });
    expect(new Headers(request?.headers).get("Idempotency-Key")).toBe("reset-mode");
  });
});
