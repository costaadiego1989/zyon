/** All monetary components use minor units in the same currency. Net receipts
 * already include coupons: a discount must never be subtracted a second time. */
export const CONTRIBUTION_DEFINITION = "net-receipts-contribution-v1";
export const CONTRIBUTION_COMPONENTS = [
  "netReceiptsCents", "productCostCents", "paymentFeesCents", "taxCents",
  "shippingCostCents", "commissionCents", "communicationCostCents", "aiCostCents",
] as const;
export type ContributionComponent = typeof CONTRIBUTION_COMPONENTS[number];
export type ContributionInput = {
  currency: string;
} & Record<ContributionComponent, number | null>;
export interface ContributionResult {
  definition: typeof CONTRIBUTION_DEFINITION;
  currency: string;
  status: "complete" | "unavailable";
  contributionCents: number | null;
  missingComponents: ContributionComponent[];
  invalidComponents: string[];
}

export function calculateContribution(input: ContributionInput): ContributionResult {
  const missingComponents = CONTRIBUTION_COMPONENTS.filter(key => input[key] == null);
  const invalidComponents: string[] = CONTRIBUTION_COMPONENTS.filter(key =>
    input[key] != null && (!Number.isSafeInteger(input[key]) || input[key]! < 0));
  if (!/^[A-Z]{3}$/.test(input.currency)) invalidComponents.push("currency");
  let contributionCents: number | null = null;
  if (!missingComponents.length && !invalidComponents.length) {
    const total = BigInt(input.netReceiptsCents!) - CONTRIBUTION_COMPONENTS.slice(1)
      .reduce((sum, key) => sum + BigInt(input[key]!), 0n);
    if (total < BigInt(Number.MIN_SAFE_INTEGER) || total > BigInt(Number.MAX_SAFE_INTEGER)) {
      invalidComponents.push("contribution_overflow");
    } else contributionCents = Number(total);
  }
  return { definition: CONTRIBUTION_DEFINITION, currency: input.currency,
    status: contributionCents === null ? "unavailable" : "complete",
    contributionCents, missingComponents, invalidComponents };
}
