import type { BillingCycle } from "@zyon/shared-types";
export type SubscriptionPlan = "starter" | "growth" | "scale";
const KEY = "zyon_subscription_intent";
const CYCLE_KEY = "zyon_billing_cycle";
const MAX_AGE = 24 * 60 * 60 * 1000;
export const PLAN_NAMES: Record<SubscriptionPlan, string> = { starter: "Free", growth: "Growth", scale: "Scale" };
export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return value === "starter" || value === "growth" || value === "scale";
}
// Stores only a navigation preference. Subscription access always comes from the API.
export function rememberSubscriptionPlan(plan: SubscriptionPlan, cycle: BillingCycle = readSubscriptionCycle()) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ plan, cycle: plan === "starter" ? "monthly" : cycle, at: Date.now() })); } catch { /* storage may be disabled */ }
}
export function readSubscriptionIntent(): SubscriptionPlan | null {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("plan");
  if (isSubscriptionPlan(query)) {
    rememberSubscriptionPlan(query, params.get("cycle") === "annual" ? "annual" : "monthly");
    return query;
  }
  if (params.has("plan")) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (saved && isSubscriptionPlan(saved.plan) && typeof saved.at === "number" && Date.now() - saved.at >= 0 && Date.now() - saved.at < MAX_AGE) return saved.plan;
    sessionStorage.removeItem(KEY);
  } catch { /* malformed or unavailable storage */ }
  return null;
}
export function clearSubscriptionIntent() {
  try { sessionStorage.removeItem(KEY); } catch { /* storage may be disabled */ }
}

export function rememberSubscriptionCycle(cycle: BillingCycle) {
  try { sessionStorage.setItem(CYCLE_KEY, cycle); } catch { /* Navigation preference only. */ }
}

export function readSubscriptionCycle(): BillingCycle {
  const params = new URLSearchParams(window.location.search);
  if (params.has("plan") || params.has("cycle")) return params.get("cycle") === "annual" ? "annual" : "monthly";
  try {
    const preference = sessionStorage.getItem(CYCLE_KEY);
    if (preference === "annual" || preference === "monthly") return preference;
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (saved?.cycle === "annual" && isSubscriptionPlan(saved.plan) && typeof saved.at === "number" && Date.now() - saved.at >= 0 && Date.now() - saved.at < MAX_AGE) return "annual";
  } catch { /* Navigation preference only. */ }
  return "monthly";
}
