import type { BillingCycle } from "@zyon/shared-types";

/** Calendar periods, including month ends and leap years. */
export function nextBillingPeriod(start: Date, cycle: BillingCycle): Date {
  const result = new Date(start);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + (cycle === "annual" ? 12 : 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
