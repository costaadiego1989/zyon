import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { LLMHypothesisGenerator } from "./hypothesis-generator.adapter.js";
import type { HypothesisGenerationRequest } from "../domain/ports/hypothesis-generator.port.js";
import { captureCheckoutChatBaseline } from "../../checkout/infrastructure/adapters/checkout-chat-baseline-capture.js";
import { checkoutBaselineReference, checkoutContractHash } from "../../checkout/domain/services/checkout-chat-baseline.js";

test("planner gateway budgets the tool schema, accepts a tool decision, and reuses only matching frozen context", async () => {
  const env = { ...process.env }, originalFetch = globalThis.fetch;
  Object.assign(process.env, { OPENAI_API_KEY: "fixture", OPENAI_MODEL: "fixture", OPENAI_BASE_URL: "https://provider.example/v1" });
  delete process.env.DEEPSEEK_API_KEY;
  const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true };
  const baseline = captureCheckoutChatBaseline({ merchantId: "store", merchantName: "Test Store", rules: { normal: [], paymentFailed: [] },
    settingsHash: "s", policyHash: checkoutContractHash(rules) }, {
    REVENUE_CHECKOUT_CONTRACT_ENABLED: "true", CHECKOUT_BEHAVIOR_REVISION: "a".repeat(40), CHECKOUT_LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture", OPENAI_MODEL: "fixture", OPENAI_BASE_URL: "https://provider.example/v1",
  })!;
  const request: HypothesisGenerationRequest = {
    merchant_id: "store", analysis_context: { runId: "run", leaseToken: 1 },
    current_prompt: checkoutBaselineReference(baseline), checkout_baseline: baseline, past_lessons: [],
    incentive_options: { definition: "revenue-incentive-options-v1", merchantId: "store", runId: "run", studyHash: "s", options: [] },
    constraints: { max_discount_percent: rules.maxDiscountPercent, allow_free_shipping: rules.allowFreeShipping,
      max_running_experiments: 1, merchant_rules: rules },
    observation: { funnel: { conversion_rate: .05, total_sessions: 100, completed_order: 5 },
      abandonment: { abandonment_rate: .95, top_abandonment_objection: "price" }, cross_sell: { acceptance_rate: 0 },
      data_quality: {}, observation_window_start: "2026-09-01", observation_window_end: "2026-09-08" } as never,
  };
  let cached: unknown, calls = 0, bytes = 0, settled = 0;
  const budget = {
    cached: async () => cached,
    reserve: async (input: { inputBytes: number }) => { bytes = input.inputBytes; return { id: "reservation", maxOutputTokens: 4096 }; },
    settle: async (_r: unknown, usage: unknown) => { assert.ok(usage); settled++; },
    cache: async (_context: unknown, _merchant: unknown, value: unknown) => { cached = value; },
  };
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.tool_choice.function.name, "submit_revenue_strategy");
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(bytes, Buffer.byteLength(JSON.stringify({ messages: body.messages, tools: body.tools, tool_choice: body.tool_choice }), "utf8"));
    assert.deepEqual(body.tools[0].function.parameters.properties.selected_action.enum, ["communication_only"]);
    return new Response(JSON.stringify({ id: "provider-receipt", usage: { prompt_tokens: 400, completion_tokens: 160 },
      choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call-one", type: "function", function: {
        name: "submit_revenue_strategy", arguments: JSON.stringify({ selected_action: "communication_only",
          rationale: "Ainda não há uma opção financeira com amostra suficiente.", hypothesis_text: "Explicar o total da compra",
          reasoning: "As sessões observadas indicam dúvida sobre preço.", name: "Clareza no checkout",
          description: "Comparar ajuda contextual com o atendimento atual.", communication_addendum: "Explique o total confirmado no carrinho." }),
      } }] } }] }));
  };
  try {
    const generator = new LLMHypothesisGenerator(budget as never);
    const first = await generator.generate(request);
    assert.equal(first.strategy_plan?.selectedAction, "communication_only");
    assert.equal(first.template.variant_a.system_prompt, request.current_prompt);
    assert.deepEqual(await generator.generate(request), first);
    assert.equal(calls, 1); assert.equal(settled, 1);
    await assert.rejects(generator.generate({ ...request, incentive_options: { ...request.incentive_options!, studyHash: "changed" } }), /BASELINE_CHANGED/);
    assert.equal(calls, 1);
    await assert.rejects(generator.generate({ ...request, incentive_options: { ...request.incentive_options!, merchantId: "other" } }), /PLANNER_CONTEXT/);
  } finally { globalThis.fetch = originalFetch; process.env = env; }
});
