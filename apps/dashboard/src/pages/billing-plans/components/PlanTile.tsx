import React from "react";
import type { BillingCycle } from "@zyon/shared-types";
import type { PlanDef } from "./PlanCard.js";
import { BillingPlanDetails } from "./BillingPlanDetails.js";

/** Approved onboarding presentation, shared without owning payment actions. */
export function PlanTile({ plan, billingCycle, selected, choice, children }: {
  plan: PlanDef;
  billingCycle: BillingCycle;
  selected: boolean;
  choice?: React.ReactNode;
  children: React.ReactNode;
}) {
  return <article data-plan-key={plan.key} className={`signup-plan${plan.recommended ? " signup-plan--featured" : ""}${selected ? " signup-plan--selected" : ""}`}>
    <BillingPlanDetails plan={plan} billingCycle={billingCycle} choice={choice} />
    {children}
  </article>;
}
