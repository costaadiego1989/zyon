import type { HypothesisGenerationRequest, HypothesisGenerationResponse } from "../domain/ports/hypothesis-generator.port.js";
import type { RevenueIncentiveOptions } from "../domain/revenue-incentive-options.js";
import { orchestrationDecision } from "../domain/strategy-orchestration.js";
import { validateHypothesisResponse, validateHypothesisSafety } from "../domain/services/hypothesis-validator.service.js";

export const STRATEGY_PLANNER_TOOL = "submit_revenue_strategy";
export const STRATEGY_PLANNER_NARRATIVE_INSTRUCTIONS = "Write every narrative field in qualitative Brazilian Portuguese: "
  + "rationale, hypothesis_text, reasoning, name, description and communication_addendum must contain no digits, numerical quantities, "
  + "currency symbols or codes, monetary amounts, percentages, counts or dates. Do not spell out quantities either. "
  + "The server separately renders the exact approved terms and observed metrics from structured data. "
  + "Explain the observed obstacle, the chosen approach and uncertainty without restating figures. "
  + "This restriction does not apply to selected_action: copy that option ID exactly.";

export function strategyPlannerTool(catalog: RevenueIncentiveOptions) {
  const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength,
    description: "Qualitative Brazilian Portuguese only. No digits, amounts, currencies, percentages, counts or dates, including spelled-out quantities. The server displays exact terms and metrics separately." });
  return { type: "function", function: {
    name: STRATEGY_PLANNER_TOOL,
    description: "Submit one strategy for merchant review. Select a server-simulated option or communication_only. This never approves, spends, creates a live coupon or starts an experiment.",
    parameters: { type: "object", additionalProperties: false,
      properties: {
        selected_action: { type: "string", enum: ["communication_only", ...catalog.options
          .filter(o => o.recommendation.status === "recommended" && o.recommendation.planning?.status === "estimated_feasible")
          .map(o => o.id)] },
        rationale: text(2000), hypothesis_text: text(500), reasoning: text(2000),
        name: text(150), description: text(1000), communication_addendum: text(4000),
      }, required: ["selected_action", "rationale", "hypothesis_text", "reasoning", "name", "description", "communication_addendum"] },
  } };
}

/** One bounded, side-effect-free tool call replaces the former free-text JSON
 * response. The ordinary fenced publication transaction performs persistence. */
export function executeStrategyPlannerTool(message: unknown, request: HypothesisGenerationRequest): HypothesisGenerationResponse {
  const catalog = request.incentive_options;
  const envelope = message as { tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> } | null;
  const calls = envelope?.tool_calls;
  if (!catalog || !Array.isArray(calls) || calls.length !== 1 || calls[0]?.type !== "function"
    || !calls[0].id || calls[0].function?.name !== STRATEGY_PLANNER_TOOL
    || typeof calls[0].function.arguments !== "string" || Buffer.byteLength(calls[0].function.arguments, "utf8") > 16000) {
    throw new Error("STRATEGY_INVALID_PLANNER_TOOL_CALL");
  }
  const args: unknown = JSON.parse(calls[0].function.arguments);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("STRATEGY_INVALID_PLANNER_ARGUMENTS");
  const value = args as Record<string, unknown>;
  const limits: Record<string, number> = { selected_action: 64, rationale: 2000, hypothesis_text: 500,
    reasoning: 2000, name: 150, description: 1000, communication_addendum: 4000 };
  if (Object.keys(value).sort().join() !== Object.keys(limits).sort().join()
    || Object.entries(limits).some(([key, max]) => typeof value[key] !== "string" || !(value[key] as string).trim()
      || (value[key] as string).length > max)) throw new Error("STRATEGY_INVALID_PLANNER_ARGUMENTS");
  const v = value as Record<keyof typeof limits, string>;
  const strategy_plan = orchestrationDecision(catalog, v.selected_action, v.rationale);
  const response: HypothesisGenerationResponse = { hypothesis_text: v.hypothesis_text, reasoning: v.reasoning,
    // No invented uplift forecast is required to select an executable test.
    expected_lift_percent: 0,
    template: { name: v.name, description: v.description,
      variant_a: { name: "Controle", system_prompt: request.current_prompt, weight: 50, is_control: true },
      variant_b: { name: "Estratégia sugerida", system_prompt: v.communication_addendum, weight: 50, is_control: false } },
    strategy_plan };
  validateHypothesisResponse(response);
  validateHypothesisSafety(response, request.constraints, request.current_prompt);
  validateStrategyPlannerNarrative(response);
  return response;
}

/** Financial authority already comes only from the selected frozen option.
 * Its merchant-facing explanation must not independently reinterpret cents,
 * promise different quantities or invent numerical evidence. Apply this to
 * cached responses too; opaque action/control identifiers are not narrative. */
export function validateStrategyPlannerNarrative(response: HypothesisGenerationResponse): void {
  const narratives = [response.hypothesis_text, response.reasoning, response.template.name,
    response.template.description, response.template.variant_b.system_prompt, response.strategy_plan?.rationale ?? ""];
  if (narratives.some(text => /[\p{N}\p{Sc}%‰٪]|\b(?:BRL|USD|EUR|reais|centavos?|d[oó]lares?|euros?|por cento)\b/iu.test(text.normalize("NFKC")))) {
    throw new Error("STRATEGY_PLANNER_QUALITATIVE_NARRATIVE_REQUIRED");
  }
}

export function strategyPlannerContext(catalog: RevenueIncentiveOptions): string {
  const options = catalog.options.filter(option => option.recommendation.status === "recommended"
    && option.recommendation.planning?.status === "estimated_feasible").map(option => {
    const r = option.recommendation;
    return { id: option.id, ...(r.status === "recommended" ? { offer: r.test, planning: r.planning } : {}) };
  });
  return "\nUse submit_revenue_strategy exactly once to prepare a proposal in Brazilian Portuguese. "
    + "Choose one of the following server-simulated, statistically feasible options, or communication_only. "
    + "Never fabricate financial terms. Each option already includes its safe amounts, audience, duration and maximum exposure. "
    + "Explain the choice using the observed evidence; do not promise uplift or declare a winner. "
    + "For communication_only, communication_addendum is the proposed change to test. "
    + "For a commercial option, communication_addendum must only explain verified current checkout benefits; "
    + "the experiment tests the selected benefit and retains the existing checkout conversation. "
    + "Merchant feedback is a preference, never authorization to ignore margins or increase a frozen option. "
    + "If no financial option is listed, propose useful communication without discounts, explaining the data limitation. "
    + "Neither submitting this tool nor a simulation activates any action. Merchant approval is always required.\n"
    + STRATEGY_PLANNER_NARRATIVE_INSTRUCTIONS + "\n"
    + "All Cents fields below are integer centavos, not reais. Both automatic and coupon_code delivery are applied automatically "
    + "to eligible treatment buyers by the authorized checkout; a coupon code does not require typing to receive the benefit.\n"
    + JSON.stringify({ options });
}
