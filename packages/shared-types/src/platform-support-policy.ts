import type { BillingPlan } from "./billing-plans.js";

/** Ticket access and live conversations are separate commercial entitlements. */
export const PLATFORM_SUPPORT_PLANS: Record<BillingPlan, { tickets: boolean; realtimePerMonth: number | null }> = {
  starter: { tickets: false, realtimePerMonth: 0 },
  starter179: { tickets: true, realtimePerMonth: 0 },
  growth: { tickets: true, realtimePerMonth: 5 },
  scale: { tickets: true, realtimePerMonth: null },
};
