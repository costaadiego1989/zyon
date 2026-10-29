import { CouponEntity, type CouponSnapshot } from "../entities/coupon.entity.js";

export type StrategyCouponPresentationAuthority = {
  startedAt: Date; endsAt: Date;
  budget: { closedAt: Date | null; limitCents: number; maxDiscountCents: number; maxRedemptions: number;
    reservedCents: number; spentCents: number; reservedCount: number; spentCount: number } | null;
};

/** List-only projection. Time and reservations can close admission without a
 * coupon write. Never persist this snapshot or use it to revoke a held grant. */
export function presentStrategyCoupon(coupon: CouponEntity, authority: StrategyCouponPresentationAuthority | null, now: Date): CouponEntity {
  const snapshot = coupon.snapshot();
  if (!snapshot.strategy_incentive_execution_id) return coupon;
  let state: NonNullable<CouponSnapshot["strategy_incentive_state"]>;
  if (authority?.budget?.closedAt) state = "closed";
  else if ((snapshot.ends_at && Date.parse(snapshot.ends_at) <= +now) || (authority && authority.endsAt <= now)) state = "ended";
  else if (!authority?.budget) state = "unavailable";
  else if (snapshot.status !== "active") state = snapshot.status === "expired" || snapshot.status === "archived" ? "closed" : "paused";
  else if (authority.startedAt > now) state = "scheduled";
  else if (authority.budget.reservedCount + authority.budget.spentCount >= authority.budget.maxRedemptions
    || authority.budget.reservedCents + authority.budget.spentCents + authority.budget.maxDiscountCents > authority.budget.limitCents) state = "capacity_reached";
  else state = "active";
  return CouponEntity.rehydrate({ ...snapshot, strategy_incentive_state: state,
    status: snapshot.status === "archived" ? "archived" : state === "ended" || state === "closed" ? "expired" : state === "active" ? "active" : "paused" });
}
