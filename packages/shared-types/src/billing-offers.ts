export type BillingCycle = "monthly" | "annual";

export interface BillingOffer {
  cycle: BillingCycle;
  amountCents: number;
  equivalentMonthlyCents: number;
  discountPercent: number;
  savingsCents: number;
}

/** Integer cents throughout; the discount is only applied to the subscription. */
export function billingOffer(monthlyCents: number, cycle: BillingCycle, discountPercent = 0): BillingOffer {
  if (!Number.isSafeInteger(monthlyCents) || monthlyCents < 0 ||
      !Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent >= 100 ||
      (cycle !== "monthly" && cycle !== "annual")) throw new Error("invalid_billing_offer");
  const undiscounted = monthlyCents * (cycle === "annual" ? 12 : 1);
  const discount = cycle === "annual" ? discountPercent : 0;
  const amountCents = Math.round(undiscounted * (100 - discount) / 100);
  if (!Number.isSafeInteger(amountCents)) throw new Error("invalid_billing_offer");
  return { cycle, amountCents, discountPercent: discount,
    equivalentMonthlyCents: cycle === "annual" ? Math.round(amountCents / 12) : amountCents,
    savingsCents: undiscounted - amountCents };
}
