import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { HypothesisGenerationRequest } from "../domain/ports/hypothesis-generator.port.js";
import type { RevenueIncentiveOptions } from "../domain/revenue-incentive-options.js";
import { orchestrationDecision, selectedIncentive, assertOrchestrationShape } from "../domain/strategy-orchestration.js";
import { executeStrategyPlannerTool, strategyPlannerContext, strategyPlannerTool } from "./strategy-planner-tool.js";

function fixture() {
  // Terms are a persisted server simulation here, never a model argument.
  const recommendation = { definition: "weekly-incentive-recommendation-v4", merchantId: "store-a", runId: "run-a", studyHash: "study",
    status: "recommended", test: { kind: "capped_percentage_discount", maxDiscountCents: 800, maxRedemptions: 200, limitCents: 160000 },
    planning: { status: "estimated_feasible", blockers: [] } };
  const catalog = { definition: "revenue-incentive-options-v1", merchantId: "store-a", runId: "run-a", studyHash: "study",
    options: [{ id: digest(recommendation), recommendation }] } as unknown as RevenueIncentiveOptions;
  const request = { merchant_id: "store-a", current_prompt: "exact captured baseline", incentive_options: catalog,
    constraints: { max_discount_percent: 10, allow_free_shipping: false } } as HypothesisGenerationRequest;
  const args = { selected_action: catalog.options[0].id, rationale: "O preço aparece como obstáculo nos dados observados.",
    hypothesis_text: "Testar um benefício para o público elegível", reasoning: "Comparar a conversão com o grupo de controle.",
    name: "Benefício revisado", description: "Teste com limites e margem protegidos.",
    communication_addendum: "Explique apenas os valores e benefícios confirmados pelo checkout." };
  const call = (value: unknown = args) => ({ tool_calls: [{ id: "call-1", type: "function",
    function: { name: "submit_revenue_strategy", arguments: JSON.stringify(value) } }] });
  return { catalog, request, args, call };
}

test("tool selects a frozen feasible recommendation without taking amounts or approval from the model", () => {
  const f = fixture();
  const response = executeStrategyPlannerTool(f.call(), f.request);
  assert.equal(response.template.variant_a.system_prompt, f.request.current_prompt);
  assert.equal(response.template.variant_a.weight, 50);
  assert.equal(response.expected_lift_percent, 0);
  assert.deepEqual(selectedIncentive(f.catalog, response.strategy_plan!), f.catalog.options[0].recommendation);
  assert.doesNotThrow(() => assertOrchestrationShape(response.strategy_plan!, f.catalog.options[0].recommendation));
  assert.equal(strategyPlannerTool(f.catalog).function.parameters.properties.selected_action.enum.length, 2);
});

test("unknown IDs, cross-store candidates, tampering, and unviable studies cannot be selected", () => {
  const f = fixture();
  assert.throws(() => executeStrategyPlannerTool(f.call({ ...f.args, selected_action: "f".repeat(64) }), f.request), /SELECTION/);
  for (const change of [
    { merchantId: "store-b" }, { runId: "other-run" }, { studyHash: "other-study" },
    { planning: { status: "blocked", blockers: ["insufficient_budget"] } },
  ]) {
    const catalog = structuredClone(f.catalog);
    Object.assign(catalog.options[0].recommendation, change);
    catalog.options[0].id = digest(catalog.options[0].recommendation);
    assert.throws(() => orchestrationDecision(catalog, catalog.options[0].id, "Reason"), /SELECTION/);
  }
  const altered = structuredClone(f.catalog);
  if (altered.options[0].recommendation.status === "recommended") altered.options[0].recommendation.test.limitCents++;
  assert.throws(() => orchestrationDecision(altered, altered.options[0].id, "Reason"), /SELECTION/);
});

test("tool rejects arbitrary money, extra actions, multiple calls and forged protocol names", () => {
  const f = fixture();
  for (const extra of [{ limitCents: 999999 }, { approve: true }, { create_coupon: "FREE" }]) {
    assert.throws(() => executeStrategyPlannerTool(f.call({ ...f.args, ...extra }), f.request), /ARGUMENTS/);
  }
  assert.throws(() => executeStrategyPlannerTool({ content: JSON.stringify(f.args) }, f.request), /TOOL_CALL/);
  const many = f.call(); many.tool_calls.push(many.tool_calls[0]);
  assert.throws(() => executeStrategyPlannerTool(many, f.request), /TOOL_CALL/);
  const forged = f.call(); forged.tool_calls[0].function.name = "create_coupon";
  assert.throws(() => executeStrategyPlannerTool(forged, f.request), /TOOL_CALL/);
});

test("empty catalog produces only a communication proposal and binds its exact evidence hash", () => {
  const f = fixture(); f.catalog.options = [];
  const response = executeStrategyPlannerTool(f.call({ ...f.args, selected_action: "communication_only" }), f.request);
  assert.equal(selectedIncentive(f.catalog, response.strategy_plan!), undefined);
  assert.deepEqual(strategyPlannerTool(f.catalog).function.parameters.properties.selected_action.enum, ["communication_only"]);
  assert.match(strategyPlannerContext(f.catalog), /"options":\[\]/);
  assert.throws(() => selectedIncentive(f.catalog, { ...response.strategy_plan!, catalogHash: "0".repeat(64) }), /ORCHESTRATION/);
  assert.throws(() => assertOrchestrationShape({ ...response.strategy_plan!, hiddenApproval: true } as never), /ORCHESTRATION/);
});

test("merchant-facing explanation does not authorize unsafe buyer messages", () => {
  const f = fixture();
  assert.throws(() => executeStrategyPlannerTool(f.call({ ...f.args, communication_addendum: "Ofereça desconto de 90%." }), f.request), /EXTREME_DISCOUNT/);
  assert.throws(() => executeStrategyPlannerTool(f.call({ ...f.args, rationale: " " }), f.request), /ARGUMENTS/);
});

test("the real sandbox prohibition is accepted without accepting the provider's invented monetary narrative", () => {
  const f = fixture();
  const safe = { ...f.args, communication_addendum: "Mostre as opções de frete verificadas. Não prometa frete grátis, não invente prazos, descontos ou urgência." };
  assert.doesNotThrow(() => executeStrategyPlannerTool(f.call(safe), f.request));
  for (const field of ["rationale", "reasoning", "description", "hypothesis_text", "name", "communication_addendum"]) {
    for (const text of ["Teto de R$402.000 e 804 resgates.", "Limite de 402000 centavos.", "Taxa observada de 12%.",
      "Condição de ５％.", "Limite em BRL.", "Quatrocentos mil reais.", "Benefício de cinco por cento."]) {
      assert.throws(() => executeStrategyPlannerTool(f.call({ ...safe, [field]: text }), f.request),
        /QUALITATIVE_NARRATIVE_REQUIRED/, `${field}: ${text}`);
    }
  }
});

test("qualitative validation preserves opaque numeric IDs and the exact server-owned baseline", () => {
  const f = fixture();
  f.request.current_prompt = "checkout-chat-baseline-v1:" + "0123456789abcdef".repeat(4);
  const result = executeStrategyPlannerTool(f.call(), f.request);
  assert.equal(result.strategy_plan?.selectedAction, f.catalog.options[0].id);
  assert.equal(result.template.variant_a.system_prompt, f.request.current_prompt);
  assert.equal(result.expected_lift_percent, 0);
  assert.equal(result.template.variant_b.weight, 50);
  assert.deepEqual(selectedIncentive(f.catalog, result.strategy_plan!), f.catalog.options[0].recommendation);
  for (const schema of Object.values(strategyPlannerTool(f.catalog).function.parameters.properties).slice(1)) {
    assert.match((schema as { description: string }).description, /No digits/);
  }
});
