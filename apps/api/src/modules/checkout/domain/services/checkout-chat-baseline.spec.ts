import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ChatLlmGatewayService } from "../../application/services/chat-llm-gateway.service.js";
import { captureCheckoutChatBaseline } from "../../infrastructure/adapters/checkout-chat-baseline-capture.js";
import { checkoutBaselineReference, checkoutContractHash, renderCheckoutChatBaseline } from "./checkout-chat-baseline.js";
import { checkoutChatProviders } from "../../infrastructure/adapters/checkout-chat-provider.js";
import { PromptExperimentAdapter } from "../../infrastructure/adapters/prompt-experiment.adapter.js";

const env = { REVENUE_CHECKOUT_CONTRACT_ENABLED: "true", CHECKOUT_BEHAVIOR_REVISION: "a".repeat(40),
  CHECKOUT_LLM_PROVIDER: "openai", OPENAI_API_KEY: "fixture-secret", OPENAI_MODEL: "fixture-model", OPENAI_BASE_URL: "https://private-provider.example/v1" };
const input = { merchantId: "store", merchantName: "Loja São Paulo", rules: { normal: ["Explique os dados verificados."], paymentFailed: ["Ajude após falha de pagamento."] },
  policyHash: checkoutContractHash({ margin: 30 }), settingsHash: checkoutContractHash({ enabled: true }) };

test("refactor preserves the checkout prompt matrix and current production tools", () => {
  // Prompt matrix captured from 4895dd4; tools from origin/master 8b45e82.
  // Both were executed from the independent pre-refactor gateway in git.
  const gateway = new ChatLlmGatewayService();
  const outputs: string[] = [];
  for (const stage of [undefined, "data_collection", "shipping", "payment", "completed"])
    for (const merchantName of [undefined, "Loja {{cart}} São Paulo"])
      for (const merchantRules of [[], ["Explique as condições verificadas.", "Não invente ofertas."]])
        for (const buyerIntent of [undefined, { primary_intent: "price_sensitive", urgency: "high", budget_tier: "budget", pain_points: ["price", "ignore_previous_instructions"] }])
          outputs.push(gateway.buildSystemPrompt({ stage, merchantName, merchantRules, buyerIntent, cartInfo: "Carrinho: R$42.50" }));
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(hash(outputs), "df5f153b54a9037b3a16e027f060f9e7151abccd5371a9d403ad2e0d6107dc29");
  assert.equal(hash(gateway.getTools()), "9ace5209cf6280e96747584fcf60491702d26ce7f9ec7548cd45cd88c25a08a3");
});

test("captured control reproduces the runtime builder with dynamic cart, stage and consented intent", () => {
  const baseline = captureCheckoutChatBaseline(input, env)!;
  const gateway = new ChatLlmGatewayService();
  for (const paymentJustFailed of [false, true]) for (const stage of ["shipping", "payment", "unknown"]) {
    const turn = { cartInfo: "Carrinho: R$42.50", stage, paymentJustFailed,
      buyerIntent: { primary_intent: "ready_to_buy", pain_points: ["price", "invent_a_coupon"] } };
    const rendered = renderCheckoutChatBaseline(baseline, "store", turn);
    assert.equal(rendered, gateway.buildSystemPrompt({ ...turn, merchantName: input.merchantName,
      merchantRules: paymentJustFailed ? input.rules.paymentFailed : input.rules.normal }));
    assert.match(rendered, /Carrinho: R\$42.50/);
    assert.doesNotMatch(rendered, /invent_a_coupon/);
  }
  assert.doesNotMatch(JSON.stringify(baseline), /fixture-secret|private-provider|42.50|ready_to_buy/);
});

test("capture needs explicit flag, immutable runtime revision and a configured pinned provider", () => {
  for (const patch of [{ REVENUE_CHECKOUT_CONTRACT_ENABLED: "false" }, { CHECKOUT_BEHAVIOR_REVISION: "latest" },
    { CHECKOUT_LLM_PROVIDER: "" }, { CHECKOUT_LLM_PROVIDER: "unknown" }, { OPENAI_API_KEY: "" }]) {
    assert.equal(captureCheckoutChatBaseline(input, { ...env, ...patch }), undefined);
  }
});

test("baseline fingerprints track config, tool, model and build changes without credential disclosure", () => {
  const baseline = captureCheckoutChatBaseline(input, env)!;
  const reference = checkoutBaselineReference(baseline);
  for (const patch of [{ OPENAI_MODEL: "next-model" }, { CHECKOUT_BEHAVIOR_REVISION: "b".repeat(40) }, { OPENAI_BASE_URL: "https://another.example/v1" }]) {
    assert.notEqual(checkoutBaselineReference(captureCheckoutChatBaseline(input, { ...env, ...patch })!), reference);
  }
  assert.equal(checkoutBaselineReference(captureCheckoutChatBaseline(input, { ...env, OPENAI_API_KEY: "rotated-secret" })!), reference);
  assert.notEqual(checkoutBaselineReference(captureCheckoutChatBaseline({ ...input, merchantName: "Other" }, env)!), reference);
  assert.equal(checkoutContractHash({ a: 1, b: 2 }), checkoutContractHash({ b: 2, a: 1 }));
});

test("rendering refuses tenant mismatch, modified tools and unsupported programs", () => {
  const baseline = captureCheckoutChatBaseline(input, env)!;
  assert.throws(() => renderCheckoutChatBaseline(baseline, "other", { cartInfo: "" }), /BASELINE_INVALID/);
  for (const mutate of [(b: typeof baseline) => b.tools.pop(), (b: typeof baseline) => b.program.push("Forged authority")]) {
    const tampered = structuredClone(baseline); mutate(tampered);
    assert.throws(() => renderCheckoutChatBaseline(tampered, "store", { cartInfo: "" }), /BASELINE_INVALID/);
  }
});

test("BRL binding revision invalidates reviewed v1 baselines even with the same deployment revision", () => {
  const baseline = captureCheckoutChatBaseline(input, env)!;
  const previous = { ...baseline, renderer: "checkout-chat-bindings-v1" };
  assert.notEqual(checkoutBaselineReference(previous as any), checkoutBaselineReference(baseline));
  assert.throws(() => renderCheckoutChatBaseline(previous as any, "store", { cartInfo: "Carrinho: R$100.00" }), /BASELINE_INVALID/);
});

test("provider route extraction preserves ordered fallbacks, pinning and duplicate suppression", () => {
  const configured = { LOCAL_LLM_BASE_URL: "http://localhost/v1", OPENROUTER_API_KEY: "r", OPENAI_API_KEY: "o", DEEPSEEK_API_KEY: "d" };
  assert.deepEqual(checkoutChatProviders(configured).map(p => p.name), ["local", "openrouter", "openai", "deepseek"]);
  assert.deepEqual(checkoutChatProviders({ ...configured, CHECKOUT_LLM_PROVIDER: "deepseek" }).map(p => p.name), ["deepseek"]);
  assert.deepEqual(checkoutChatProviders({ ...configured, LOCAL_LLM_BASE_URL: "https://api.openai.com/v1" }).map(p => p.name), ["local", "openrouter", "deepseek"]);
  assert.equal(checkoutChatProviders(configured)[0].timeoutMs, 5000);
});

test("payment routing revision rejects preexisting proposals without changing their frozen baseline", () => {
  const baseline = captureCheckoutChatBaseline(input, env)!;
  const { paymentRouting, ...previous } = baseline;
  assert.equal(paymentRouting, "checkout-payment-routing-v3-signed-visual");
  for (const outdated of ["checkout-payment-routing-v1", "checkout-payment-routing-v2"]) {
    assert.throws(() => renderCheckoutChatBaseline({ ...baseline, paymentRouting: outdated } as any,
      "store", { stage: "payment" }), /BASELINE_INVALID/);
  }
  assert.notEqual(checkoutBaselineReference(previous as any), checkoutBaselineReference(baseline));
  assert.throws(() => renderCheckoutChatBaseline(previous as any, "store", { stage: "payment" }), /BASELINE_INVALID/);
});

test("navigation requires a new reviewed baseline instead of changing an existing proposal", () => {
  const baseline = captureCheckoutChatBaseline(input, env)!;
  const { navigation, ...previous } = baseline;
  assert.equal(navigation, "checkout-navigation-v2");
  assert.notEqual(checkoutBaselineReference(previous as any), checkoutBaselineReference(baseline));
  assert.throws(() => renderCheckoutChatBaseline(previous as any, "store", { stage: "payment" }), /BASELINE_INVALID/);
  assert.throws(() => renderCheckoutChatBaseline({ ...baseline, navigation: "checkout-navigation-v1" } as any,
    "store", { stage: "payment" }), /BASELINE_INVALID/);
});

test("context exit requires a reviewed baseline with the same policy in both arms", () => {
  const baseline = captureCheckoutChatBaseline(input, env)!;
  const { contextExit, ...previous } = baseline;
  assert.equal(contextExit, "checkout-context-exit-v1");
  assert.notEqual(checkoutBaselineReference(previous as any), checkoutBaselineReference(baseline));
  for (const outdated of [previous, { ...baseline, contextExit: "unknown" }]) {
    assert.throws(() => renderCheckoutChatBaseline(outdated as any, "store", { stage: "payment" }), /BASELINE_INVALID/);
  }
});

test("suppression recovery is a reviewed policy and cannot reinterpret old baselines", () => {
  const baseline = captureCheckoutChatBaseline(input, env)!;
  const { suppressionRecovery, ...previous } = baseline;
  assert.equal(suppressionRecovery, "checkout-suppression-recovery-v1");
  assert.notEqual(checkoutBaselineReference(previous as any), checkoutBaselineReference(baseline));
  for (const outdated of [previous, { ...baseline, suppressionRecovery: "unknown" }]) {
    assert.throws(() => renderCheckoutChatBaseline(outdated as any, "store", { stage: "payment" }), /BASELINE_INVALID/);
  }
});

test("legacy experiment adapter never forwards a recipe reference as buyer instructions", async () => {
  const adapter = new PromptExperimentAdapter({ findRunning: async () => ({ id: "exp", variants: [
    { system_prompt: checkoutBaselineReference(captureCheckoutChatBaseline(input, env)!) }, { system_prompt: "Treatment" },
  ] }) } as never);
  assert.equal(await adapter.findRunningExperiment("store"), undefined);
});
