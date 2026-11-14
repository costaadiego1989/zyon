import type { TabKey } from "./nav-config.js";
import type { Role } from "../lib/auth/roles.js";
import { canAccessTab } from "../lib/auth/permissions.js";

export const SUBSCRIPTION_RECOVERY_TABS = [
  "marketplace-payments", "marketplace-shipments", "marketplace-refunds",
  "marketplace-asaas-wallet-returns", "marketplace-contributions",
  "marketplace-fees", "marketplace-host-fees",
] as const satisfies readonly TabKey[];
const recoveryTabs = new Set<TabKey>(SUBSCRIPTION_RECOVERY_TABS);

/** UI routing only. API tenant, role and commercial authorization still apply. */
export function isSubscriptionRouteAllowed(tab: TabKey, required: boolean, role: Role | undefined): boolean {
  if (!required) return true;
  if (tab === "account-settings") return true;
  if (!role || !canAccessTab(role, tab)) return false;
  return tab === "billing-plans" || tab === "billing" || recoveryTabs.has(tab);
}

export function resolveSubscriptionTab(tab: TabKey, required: boolean, role: Role | undefined): TabKey {
  if (isSubscriptionRouteAllowed(tab, required, role)) return tab;
  return role === "OWNER" ? "billing-plans" : "account-settings";
}
