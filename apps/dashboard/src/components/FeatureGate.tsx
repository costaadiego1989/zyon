import React, { createContext, useContext } from "react";

export type MerchantPlanType = "STORE_ONLY" | "BOTH" | "API";

export interface FeatureGateProps {
  plan: MerchantPlanType | MerchantPlanType[];
  children: React.ReactNode;
  lockedMessage?: string;
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

interface PlanContextType {
  merchantPlan?: MerchantPlanType;
}

const PlanContext = createContext<PlanContextType>({ merchantPlan: undefined });

export function PlanProvider({ children, merchantPlan }: { children: React.ReactNode; merchantPlan?: MerchantPlanType }) {
  return (
    <PlanContext.Provider value={{ merchantPlan }}>
      {children}
    </PlanContext.Provider>
  );
}

export function useMerchantPlan() {
  return useContext(PlanContext).merchantPlan;
}

export function FeatureGate({ plan, children, lockedMessage }: FeatureGateProps) {
  const merchantPlan = useMerchantPlan();

  // If no plan context available, gracefully allow (dev/testing)
  if (!merchantPlan) {
    return <>{children}</>;
  }

  // Normalize plan to array for comparison
  const requiredPlans = Array.isArray(plan) ? plan : [plan];
  const isAllowed = requiredPlans.includes(merchantPlan);

  if (!isAllowed) {
    if (lockedMessage) {
      return (
        <div style={{
          padding: "20px",
          borderRadius: "var(--radius-md)",
          background: "var(--color-error-bg)",
          border: "1px solid var(--color-error-ring)",
          color: "var(--color-text-muted)",
          font: "13px var(--font-sans)",
        }}>
          {lockedMessage}
        </div>
      );
    }
    return null;
  }

  return <>{children}</>;
}
