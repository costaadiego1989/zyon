import type { HypothesisGenerationResponse } from "../ports/hypothesis-generator.port.js";
import { proposedPrompt } from "../services/hypothesis-validator.service.js";

export type HypothesisRiskLevel = "low" | "medium" | "high";

/** Unstructured proposals cannot establish financial authorization or bounded risk. */
export function assessHypothesisRisk(proposal: HypothesisGenerationResponse, currentPrompt?: string): HypothesisRiskLevel {
  const text = [proposal.hypothesis_text, proposal.template.name, proposal.template.description,
    proposedPrompt(proposal.template.variant_b.system_prompt, currentPrompt)]
    .join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/discount|desconto|cupom|coupon|cashback|rebate|bonus|brinde|free shipping|free delivery|frete gratis|frete gratuito|entrega gratis|subsid|cover.*shipping|\d\s*%|(?:r\$|\$|€|£)\s*\d/.test(text)) {
    return "high";
  }
  // Messaging stays under review until a structured action contract proves its scope.
  return "medium";
}

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
