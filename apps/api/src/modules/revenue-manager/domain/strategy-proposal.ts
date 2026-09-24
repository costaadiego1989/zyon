import type { MerchantRules } from "@zyon/shared-types";
import type { ObservationSnapshot } from "./entities/observation.entity.js";
import type { HypothesisGenerationResponse } from "./ports/hypothesis-generator.port.js";
import { validateHypothesisResponse, validateHypothesisSafety } from "./services/hypothesis-validator.service.js";
import { assertCheckoutChatBaseline, checkoutBaselineReference, checkoutContractHash,
  type CheckoutChatBaseline } from "../../checkout/domain/services/checkout-chat-baseline.js";

export type StrategyProposal = {
  definition: "checkout-strategy-review-v1";
  recommendation: HypothesisGenerationResponse;
  observation: ObservationSnapshot;
  rules: MerchantRules;
  // A candidate control is not proof that checkout can replay this baseline.
  baselineStatus: "awaiting_checkout_contract" | "primary_chat_contract_captured";
  checkoutBaseline?: CheckoutChatBaseline;
  execution: "unavailable";
  expectedLiftStatus: "model_estimate_not_measured";
};

export function strategyProposal(recommendation: HypothesisGenerationResponse,
  observation: ObservationSnapshot, rules: MerchantRules, checkoutBaseline?: CheckoutChatBaseline): StrategyProposal {
  validateHypothesisResponse(recommendation);
  const { variant_a: control, variant_b: treatment } = recommendation.template;
  if (!control.is_control || treatment.is_control || control.weight !== 50 || treatment.weight !== 50
    || control.system_prompt === treatment.system_prompt) throw new Error("STRATEGY_INVALID_VARIANTS");
  if (rules.autonomousEngineEnabled !== true) throw new Error("STRATEGY_ENGINE_DISABLED");
  validateHypothesisSafety(recommendation, { max_discount_percent: rules.maxDiscountPercent,
    allow_free_shipping: rules.allowFreeShipping }, control.system_prompt);
  if (checkoutBaseline) {
    assertCheckoutChatBaseline(checkoutBaseline, observation.merchant_id);
    if (control.system_prompt !== checkoutBaselineReference(checkoutBaseline)
      || checkoutBaseline.policyHash !== checkoutContractHash(rules)) throw new Error("STRATEGY_BASELINE_CHANGED");
    if (treatment.system_prompt.includes("checkout-chat-baseline-v1:") || treatment.system_prompt.length > 4000) {
      throw new Error("STRATEGY_INVALID_COMMUNICATION_ADDENDUM");
    }
  } else if (control.system_prompt.startsWith("checkout-chat-baseline-v1:")) throw new Error("STRATEGY_BASELINE_ARTIFACT_REQUIRED");
  const value: StrategyProposal = { definition: "checkout-strategy-review-v1", recommendation, observation, rules,
    baselineStatus: checkoutBaseline ? "primary_chat_contract_captured" : "awaiting_checkout_contract",
    ...(checkoutBaseline ? { checkoutBaseline } : {}), execution: "unavailable", expectedLiftStatus: "model_estimate_not_measured" };
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 200_000) throw new Error("STRATEGY_CONTEXT_TOO_LARGE");
  return structuredClone(value);
}
