import { describe, expect, it } from "vitest";
import type { Coupon } from "./useCouponsPage.js";
import { couponMatchesStatusFilter, couponStatus, couponStatusLabels } from "./coupon-status.js";

const now = Date.parse("2026-10-05T12:00:00Z");
const coupon: Coupon = { id: "c", code: "ZYON0123456789ABCDEF0123", discountType: "fixed", discountValue: 10,
  usedCount: 0, isActive: true, status: "active", createdAt: "2026-10-05T00:00:00Z",
  strategyIncentiveExecutionId: "execution-1", strategyIncentiveState: "active", expiresAt: "2026-10-12T12:00:00Z" };

describe("effective strategy coupon status", () => {
  it.each([
    ["scheduled", "Agendado", "paused"], ["capacity_reached", "Limite atingido", "paused"],
    ["ended", "Encerrado", "expired"], ["closed", "Interrompido", "expired"],
    ["paused", "Pausado", "paused"], ["unavailable", "Indisponível", "paused"],
  ] as const)("labels and filters %s without advertising an active coupon", (state, label, filter) => {
    const value = { ...coupon, strategyIncentiveState: state };
    expect(couponStatusLabels[couponStatus(value, now)]).toBe(label);
    expect(couponMatchesStatusFilter(value, "active", now)).toBe(false);
    expect(couponMatchesStatusFilter(value, filter, now)).toBe(true);
    expect(couponMatchesStatusFilter(value, filter === "paused" ? "expired" : "paused", now)).toBe(false);
  });
  it("treats an expired projection or elapsed exact deadline as ended even with stale active flags", () => {
    for (const value of [{ ...coupon, status: "expired" }, { ...coupon, expiresAt: "2026-10-05T11:59:00Z" }]) {
      expect(couponStatus(value, now)).toBe("ended");
      expect(couponMatchesStatusFilter(value, "active", now)).toBe(false);
      expect(couponMatchesStatusFilter(value, "expired", now)).toBe(true);
    }
  });
  it("keeps missing strategy state unavailable and respects ordinary coupon validity", () => {
    expect(couponStatus({ ...coupon, strategyIncentiveState: undefined }, now)).toBe("unavailable");
    expect(couponStatus({ ...coupon, strategyIncentiveExecutionId: null, expiresAt: "2026-10-04" }, now)).toBe("expired");
    expect(couponStatus({ ...coupon, strategyIncentiveExecutionId: null }, now)).toBe("active");
    expect(couponMatchesStatusFilter(coupon, "active", now)).toBe(true);
  });
});
