import { useState } from "react";
import type { BillingCycle } from "@zyon/shared-types";
import { readSubscriptionCycle, rememberSubscriptionCycle } from "../../auth/subscription-intent.js";

export function useBillingCycle() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(readSubscriptionCycle);
  return [billingCycle, (cycle: BillingCycle) => {
    rememberSubscriptionCycle(cycle);
    setBillingCycle(cycle);
  }] as const;
}
