import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { captureCheckoutChatBaseline, checkoutBaselineReference, checkoutContractHash } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { LLMHypothesisGenerator } from "./hypothesis-generator.adapter.js";
import type { HypothesisGenerationRequest } from "../domain/ports/hypothesis-generator.port.js";
import type { SharedStrategyLearning } from "../domain/shared-strategy-learning.js";

const environment = { ...process.env }, originalFetch = globalThis.fetch;
afterEach(() => { process.env = { ...environment }; globalThis.fetch = originalFetch; });
function fixture() {
  Object.assign(process.env, { OPENAI_API_KEY: "fixture", OPENAI_MODEL: "fixture", DEEPSEEK_API_KEY: "",
    OPENAI_BASE_URL: "https://provider.example.invalid/v1" });
  const baseline = captureCheckoutChatBaseline({ merchantId: "target", merchantName: "Target",
    rules: { normal: [], paymentFailed: [] }, settingsHash: "s", policyHash: checkoutContractHash(DEFAULT_MERCHANT_RULES) },
  { ...process.env, REVENUE_CHECKOUT_CONTRACT_ENABLED: "true", CHECKOUT_BEHAVIOR_REVISION: "a".repeat(40), CHECKOUT_LLM_PROVIDER: "openai" })!;
  const request = { merchant_id: "target", analysis_context: { runId: "run", leaseToken: 1 },
    checkout_baseline: baseline, current_prompt: checkoutBaselineReference(baseline), past_lessons: [],
    observation: { observation_window_start: "2030-09-01", observation_window_end: "2030-09-08",
      funnel: { total_sessions: 100, completed_order: 10, conversion_rate: .1 },
      abandonment: { abandonment_rate: .9, top_abandonment_objection: "unknown" },
      cross_sell: { acceptance_rate: 0 }, data_quality: {} },
    constraints: { max_discount_percent: 5, allow_free_shipping: false, max_running_experiments: 1, merchant_rules: DEFAULT_MERCHANT_RULES } } as HypothesisGenerationRequest;
  let learning: SharedStrategyLearning | undefined = { definition: "shared-strategy-learning-v1", asOf: "2030-09-08T00:00:00Z",
    contextHash: "a".repeat(64), scope: "communication_only", economicClaim: "conversion_is_not_profit", lessons: [{
      pattern: "shipping_clarity", signal: "worth_local_test", evidence: "mature_conversion_results_from_multiple_independent_stores",
      use: "new_local_hypothesis_requiring_merchant_approval" }] };
  let checkpoint: unknown = null;
  const calls: string[] = [], prompts: string[] = [];
  const budget = { cached: async () => checkpoint, reserve: async () => { calls.push("reserve"); return { id: "attempt", maxOutputTokens: 500 }; },
    settle: async () => { calls.push("settle"); }, cache: async (_c: unknown, _m: unknown, value: unknown) => { checkpoint = value; } };
  const shared = { prepare: async () => learning };
  globalThis.fetch = async (_url, options) => {
    calls.push("fetch"); prompts.push(JSON.parse(String(options?.body)).messages[1].content);
    return new Response(JSON.stringify({ id: "fake-call", usage: { prompt_tokens: 50, completion_tokens: 50 }, choices: [{ message: { content: JSON.stringify({
      hypothesis_text: "Testar clareza das informações de entrega", reasoning: "Validar uma hipótese com dados locais", expected_lift_percent: 1,
      template: { name: "Informações claras", description: "Teste de comunicação",
        variant_a: { name: "Controle", system_prompt: request.current_prompt, is_control: true, weight: 50 },
        variant_b: { name: "Tratamento", system_prompt: "Explique somente as informações verificadas de entrega.", is_control: false, weight: 50 } },
    }) } }] }));
  };
  return { request, calls, prompts, generator: new LLMHypothesisGenerator(budget as never, shared as never),
    changeLearning: () => { learning = undefined; } };
}

test("shared lessons join the one existing budgeted call, and retry reuses its exact checkpoint", async () => {
  const f = fixture();
  await f.generator.generate(f.request);
  await f.generator.generate(f.request);
  assert.deepEqual(f.calls, ["reserve", "fetch", "settle"]);
  assert.match(f.prompts[0], /AGGREGATED COMMUNICATION EVIDENCE/);
  assert.match(f.prompts[0], /Conversion is not contribution or profit/);
  assert.equal(f.prompts[0].includes("a".repeat(64)), false);
  f.changeLearning();
  await assert.rejects(() => f.generator.generate(f.request), /HYPOTHESIS_BASELINE_CHANGED/);
  assert.deepEqual(f.calls, ["reserve", "fetch", "settle"]);
});

test("a financial alternative stays read-only and separate from buyer communication", async () => {
  const f = fixture();
  f.request.analysis_context!.revisionId = "revision";
  f.request.revision = { preference: "Outra sugestão", previous_proposal: {} as any, incentive_alternative: {
    discount_percent: 3, max_discount_cents: 300, limit_cents: 3_000, max_redemptions: 10, duration_days: 7,
    explanation: "lower_discount_same_audience" } };
  await f.generator.generate(f.request);
  assert.match(f.prompts[0], /read-only financial terms calculated by the server/);
  assert.match(f.prompts[0], /must not offer, promise or apply the incentive/);
  assert.deepEqual(f.calls, ["reserve", "fetch", "settle"]);
});
