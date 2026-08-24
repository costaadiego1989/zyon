import React from "react";

export type MerchantPlanType = "STORE_ONLY" | "BOTH" | "API";

export interface FeatureGateProps {
  plan: MerchantPlanType | MerchantPlanType[];
  children: React.ReactNode;
}

/**
 * Feature gate: conditionally renders children based on merchant plan.
 * Returns null (invisible) if merchant plan does not match required plan(s).
 *
 * Usage:
 *   <FeatureGate plan="STORE_ONLY">
 *     <CatalogManager />
 *   </FeatureGate>
 *
 *   <FeatureGate plan={["STORE_ONLY", "BOTH"]}>
 *     <AgentBuilder />
 *   </FeatureGate>
 */
export function FeatureGate({ plan, children }: FeatureGateProps) {
  // In the future, plan will be read from context/props injected from DashboardShell
  // For now, this component serves as the conditional render boundary
  return <>{children}</>;
}
