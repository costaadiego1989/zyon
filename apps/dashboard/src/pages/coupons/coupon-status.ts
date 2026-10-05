import type { Coupon } from "./useCouponsPage.js";

export const couponStatusLabels = {
  active: "Ativo", scheduled: "Agendado", capacity_reached: "Limite atingido", ended: "Encerrado",
  closed: "Interrompido", paused: "Pausado", unavailable: "Indisponível", expired: "Expirado",
} as const;
export type CouponStatus = keyof typeof couponStatusLabels;
export type CouponStatusFilter = "all" | "active" | "expired" | "paused";

export function couponStatus(coupon: Coupon, now = Date.now()): CouponStatus {
  if (coupon.strategyIncentiveExecutionId) {
    const state = coupon.strategyIncentiveState;
    if (!state || !Object.hasOwn(couponStatusLabels, state)) return "unavailable";
    if (state === "active") {
      if (coupon.status === "expired" || coupon.status === "archived"
        || coupon.expiresAt && Date.parse(coupon.expiresAt) <= now) return "ended";
      if (!coupon.isActive) return "unavailable";
    }
    return state;
  }
  if (coupon.status === "expired" || coupon.status === "archived") return "expired";
  // Manual coupon validity remains a calendar date, inclusive of the final day.
  const calendarDate = coupon.expiresAt && /^(\d{4})-(\d{2})-(\d{2})/.exec(coupon.expiresAt);
  if (calendarDate) {
    const [year, month, day] = calendarDate.slice(1).map(Number);
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    if (new Date(year, month - 1, day) < today) return "expired";
  } else if (coupon.expiresAt && Date.parse(coupon.expiresAt) <= now) return "expired";
  return coupon.isActive ? "active" : "paused";
}

export function couponMatchesStatusFilter(coupon: Coupon, filter: CouponStatusFilter, now = Date.now()): boolean {
  if (filter === "all") return true;
  const state = couponStatus(coupon, now);
  const ended = ["ended", "closed", "expired"].includes(state);
  return filter === "active" ? state === "active" : filter === "expired" ? ended : state !== "active" && !ended;
}
