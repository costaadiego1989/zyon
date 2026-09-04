export type HypothesisRiskLevel = "low" | "medium" | "high";

export function assessRiskLevel(expectedLiftPercent: number, maxDiscountInPrompt?: number): HypothesisRiskLevel {
  if (expectedLiftPercent >= 50 || (maxDiscountInPrompt !== undefined && maxDiscountInPrompt > 30)) {
    return "high";
  }
  if (expectedLiftPercent >= 10) {
    return "medium";
  }
  return "low";
}

export function shouldAutoApprove(riskLevel: HypothesisRiskLevel): boolean {
  return riskLevel === "low";
}
