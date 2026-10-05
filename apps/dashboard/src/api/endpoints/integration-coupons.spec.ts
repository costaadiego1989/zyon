import { describe, expect, it, vi } from "vitest";
import { integrationEndpoints } from "./integration.js";

describe("strategy coupon list projection", () => {
  it("retains the execution binding without inventing a binding for manual coupons", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { id: "strategy", code: "ZYON0123456789ABCDEF0123", discount_type: "fixed", discount_value: 10,
        strategy_incentive_execution_id: "execution-1", strategy_incentive_state: "active", max_usages: 30, usages_count: 2, status: "active" },
      { id: "manual", code: "MANUAL10", discount_type: "percent", discount_value: 10, status: "active" },
    ])));
    const result = await integrationEndpoints("https://api.test", fetchImpl).listCoupons();
    expect(result[0]).toMatchObject({ strategyIncentiveExecutionId: "execution-1", strategyIncentiveState: "active", isActive: true, discountValue: 10, maxUses: 30, usedCount: 2 });
    expect(result[1]).toMatchObject({ strategyIncentiveExecutionId: null, discountType: "percent", discountValue: 10 });
  });
  it.each(["scheduled", "capacity_reached", "ended", "closed", "paused", "unavailable", "future_state", undefined])(
    "does not reactivate a managed coupon whose effective state is %s", async state => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
        { id: "strategy", code: "ZYON0123456789ABCDEF0123", strategy_incentive_execution_id: "execution-1",
          strategy_incentive_state: state, status: "active", is_active: true, isActive: true },
      ])));
      const [coupon] = await integrationEndpoints("https://api.test", fetchImpl).listCoupons();
      expect(coupon.isActive).toBe(false);
      expect(coupon.strategyIncentiveState).toBe(!state || state === "future_state" ? "unavailable" : state);
    });
  it("preserves an expired status over stale active aliases", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { id: "strategy", code: "ZYON0123456789ABCDEF0123", strategy_incentive_execution_id: "execution-1",
        strategy_incentive_state: "active", status: "expired", is_active: true, isActive: true },
    ])));
    expect((await integrationEndpoints("https://api.test", fetchImpl).listCoupons())[0]).toMatchObject({ status: "expired", isActive: false });
  });
});
