import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { MerchantRules } from "@zyon/shared-types";
import { GenerateHypothesisUseCase } from "../use-cases/generate-hypothesis.use-case.js";
import { ObservationEntity } from "../../domain/entities/observation.entity.js";
import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";
import type { HypothesisGenerationRequest, HypothesisGenerationResponse } from "../../domain/ports/hypothesis-generator.port.js";
import type { HypothesisMerchantContextPort } from "../../domain/ports/hypothesis-merchant-context.port.js";
import { LLMHypothesisGenerator } from "../../infrastructure/hypothesis-generator.adapter.js";
import { PrismaHypothesisMerchantContext } from "../../infrastructure/hypothesis-merchant-context.adapter.js";

const baseline = "Merchant A: explain the checkout using verified cart and delivery details.";

function merchantRules(maxDiscountPercent = 8, allowFreeShipping = false): MerchantRules {
  return {
    maxDiscountPercent, allowFreeShipping, minimumMarginPercent: 35,
    allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
    freeShippingMinCartValue: 250, maxShippingSubsidy: 25, maxPartialShippingDiscount: 10,
    offerExpirationMinutes: 15, blockedRegions: [], brandVoice: "consultative",
    couponBoxEnabled: true, autonomousEngineEnabled: true,
  };
}

function observation(merchantId = "merchant-a", topReason = "price") {
  return ObservationEntity.create({
    merchant_id: merchantId, observation_window_start: new Date("2026-09-01T00:00:00Z"),
    observation_window_end: new Date("2026-09-02T00:00:00Z"),
    funnel: { total_sessions: 100, started_checkout: 100, reached_shipping: 60, reached_payment: 30, completed_order: 20, conversion_rate: 0.2 },
    abandonment: { abandoned_at_shipping: 40, abandoned_at_payment: 10, abandonment_rate: 0.8, top_abandonment_objection: topReason },
    objections: { shipping_cost_count: 10, price_count: 20, trust_count: 0, payment_count: 0, unknown_count: 20 },
    cross_sell: { suggestions_shown: 0, suggestions_accepted: 0, acceptance_rate: 0, top_suggested_skus: [] },
    cohorts: { returning_customers_rate: 0, new_customers_rate: 1, high_discount_sensitivity_rate: 0, low_discount_sensitivity_rate: 0 },
    revenue: { total_revenue_cents: 200000, avg_order_value_cents: 10000, total_orders: 20 }, ai_costs_cents: 0,
  });
}

function proposal(prompt = "Offer an 8% discount after merchant review.", lift = 1): HypothesisGenerationResponse {
  return {
    hypothesis_text: "Test a response to the observed checkout friction",
    reasoning: "Compare a reviewed challenger with the current merchant baseline",
    expected_lift_percent: lift,
    template: {
      name: "Checkout help", description: "A merchant-reviewed proposal",
      variant_a: { name: "Control", system_prompt: "Invented LLM control", is_control: true, weight: 50 },
      variant_b: { name: "Challenger", system_prompt: prompt, is_control: false, weight: 50 },
    },
  };
}

function setup(options: {
  merchantId?: string; rules?: MerchantRules | null; currentPrompt?: string | null;
  response?: unknown; generate?: (request: HypothesisGenerationRequest) => Promise<HypothesisGenerationResponse>;
  context?: HypothesisMerchantContextPort;
} = {}) {
  const merchantId = options.merchantId ?? "merchant-a";
  const obs = observation(merchantId);
  const saved: HypothesisEntity[] = [];
  const requests: HypothesisGenerationRequest[] = [];
  const reads: string[] = [];
  const rules = options.rules === null ? undefined : options.rules ?? merchantRules();
  const context = options.context ?? {
    async getRules(id: string) { reads.push(id); return rules; },
    async getCurrentPrompt(id: string) { reads.push(id); return options.currentPrompt === null ? undefined : options.currentPrompt ?? baseline; },
  };
  const useCase = new GenerateHypothesisUseCase(
    { save: async () => {}, findById: async (id, tenant) => id === obs.id && tenant === merchantId ? obs : null,
      findByFingerprint: async () => null, findLatestByMerchant: async () => obs, findByMerchant: async () => [obs] },
    { save: async (value) => { saved.push(value); }, findById: async () => null,
      findByMerchant: async () => [], findPendingByMerchant: async () => [], findByObservation: async () => [] },
    { save: async () => {}, findByMerchant: async () => [], findByExperiment: async () => [], findByHypothesis: async () => null },
    { generate: async (request) => { requests.push(request); return options.generate ? options.generate(request) : options.response === undefined ? proposal() : options.response as HypothesisGenerationResponse; } },
    context,
  );
  return { execute: () => useCase.execute({ merchant_id: merchantId, observation_id: obs.id }), useCase, obs, saved, requests, reads };
}

test("MI-V15: tenant policies govern discount caps and shipping, with no fixed limits", async () => {
  const a = setup({ response: proposal("Offer 12% discount") });
  await assert.rejects(a.execute(), /HYPOTHESIS_EXTREME_DISCOUNT/);
  assert.equal(a.saved.length, 0);
  assert.equal(a.requests[0].constraints.max_discount_percent, 8);
  assert.equal(a.requests[0].constraints.allow_free_shipping, false);

  const b = setup({ merchantId: "merchant-b", rules: merchantRules(15, true), response: proposal("Offer 12% discount"), currentPrompt: "Merchant B current configuration" });
  await b.execute();
  assert.equal(b.saved[0].merchant_id, "merchant-b");
  assert.equal(b.requests[0].constraints.max_discount_percent, 15);
  assert.equal(b.saved[0].template.variant_a.system_prompt, "Merchant B current configuration");
  assert.ok(b.reads.every((id) => id === "merchant-b"));

  const shippingA = setup({ response: proposal("Offer free shipping") });
  await assert.rejects(shippingA.execute(), /HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING/);
  const shippingB = setup({ merchantId: "merchant-b", rules: merchantRules(15, true), response: proposal("Offer free shipping") });
  assert.equal((await shippingB.execute()).approval_strategy, "manual");
});

test("MI-V15: every amount is checked, including decimals and Portuguese prefix notation", async () => {
  for (const prompt of ["Offer 5% discount, then 12% discount", "Ofereça desconto de 8,5%", "Offer discount of 9.5%", "Offer 15% off"]) {
    const fixture = setup({ response: proposal(prompt) });
    await assert.rejects(fixture.execute(), /HYPOTHESIS_EXTREME_DISCOUNT/);
    assert.equal(fixture.saved.length, 0);
  }
});

test("MI-V15: low predicted lift never auto-approves monetary proposals", async () => {
  for (const lift of [0, 1, 100]) {
    const fixture = setup({ response: proposal("Offer 8% discount", lift) });
    const result = await fixture.execute();
    assert.equal(result.risk_level, "high");
    assert.equal(result.approval_strategy, "manual");
    assert.equal(fixture.saved[0].status, "pending_review");
    assert.equal(fixture.saved[0].snapshot().merchant_approved_by, undefined);
    assert.equal(fixture.saved[0].template.variant_a.system_prompt, baseline);
    assert.equal(fixture.requests[0].current_prompt, baseline);
  }
});

test("MI-V15: unstructured messaging stays pending human review", async () => {
  const fixture = setup({ response: proposal("Ask whether the buyer needs help with the checkout step.", 100) });
  assert.equal((await fixture.execute()).risk_level, "medium");
  assert.equal(fixture.saved[0].status, "pending_review");
});

test("MI-V11: unchanged baseline guardrails are preserved, and new violations remain blocked", async () => {
  const guardedBaseline = "Nunca solicite CVV/senha. Não ofereça frete grátis ou desconto de 90%.";
  const fixture = setup({ currentPrompt: guardedBaseline, response: proposal(`${guardedBaseline}\n\nAsk whether the buyer needs help.`) });
  assert.equal((await fixture.execute()).risk_level, "medium");
  assert.equal(fixture.saved[0].template.variant_a.system_prompt, guardedBaseline);
  assert.equal(fixture.saved[0].status, "pending_review");
  const unsafe = setup({ currentPrompt: guardedBaseline, response: proposal(`${guardedBaseline}\n\nOffer 90% discount.`) });
  await assert.rejects(unsafe.execute(), /HYPOTHESIS_EXTREME_DISCOUNT/);
  assert.equal(unsafe.saved.length, 0);
});

test("MI-V20: missing policy, disabled engine and missing baseline suppress before generation", async () => {
  for (const [options, expected] of [
    [{ rules: null }, /HYPOTHESIS_MERCHANT_RULES_UNAVAILABLE/],
    [{ rules: { ...merchantRules(), autonomousEngineEnabled: false } }, /HYPOTHESIS_ENGINE_DISABLED/],
    [{ rules: { ...merchantRules(), maxDiscountPercent: Number.NaN } }, /HYPOTHESIS_INVALID_MERCHANT_RULES/],
    [{ currentPrompt: null }, /HYPOTHESIS_BASELINE_UNAVAILABLE/],
  ] as const) {
    const fixture = setup(options);
    await assert.rejects(fixture.execute(), expected);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.saved.length, 0);
  }
});

test("MI-V20: empty observations and wrong tenant never generate", async () => {
  const empty = setup();
  empty.obs.funnel.total_sessions = 0;
  await assert.rejects(empty.execute(), /HYPOTHESIS_INSUFFICIENT_OBSERVATIONS/);
  assert.equal(empty.requests.length, 0);
  const fixture = setup();
  await assert.rejects(fixture.useCase.execute({ merchant_id: "merchant-b", observation_id: fixture.obs.id }), /OBSERVATION_NOT_FOUND/);
  assert.equal(fixture.requests.length, 0);
});

test("MI-V20: invalid generator payloads are rejected before persistence", async () => {
  const reversed = proposal();
  reversed.template.variant_a.is_control = false;
  reversed.template.variant_b.is_control = true;
  for (const response of [null, {}, { ...proposal(), expected_lift_percent: NaN }, { ...proposal(), expected_lift_percent: Infinity }, reversed,
    { ...proposal(), template: { ...proposal().template, variant_b: null } }]) {
    const fixture = setup({ response });
    await assert.rejects(fixture.execute(), /HYPOTHESIS_INVALID_JSON/);
    assert.equal(fixture.saved.length, 0);
  }
});

test("MI-V20: kill-switch, policy and baseline changes during generation prevent persistence", async () => {
  for (const change of ["disabled", "policy", "baseline"]) {
    let generated = false;
    const fixture = setup({
      context: {
        getRules: async () => ({ ...merchantRules(), ...(generated && change === "disabled" ? { autonomousEngineEnabled: false } : {}), ...(generated && change === "policy" ? { maxDiscountPercent: 5 } : {}) }),
        getCurrentPrompt: async () => generated && change === "baseline" ? "New baseline" : baseline,
      },
      generate: async () => { generated = true; return proposal(); },
    });
    await assert.rejects(fixture.execute(), /HYPOTHESIS_(ENGINE_DISABLED|MERCHANT_RULES_CHANGED|BASELINE_CHANGED)/);
    assert.equal(fixture.saved.length, 0);
  }
});

test("MI-V20: fallback preserves baseline and adds help without invented offers or security claims", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    for (const reason of ["price", "shipping_cost", "payment", "unknown"]) {
      const fixture = setup({ generate: (request) => new LLMHypothesisGenerator().generate({ ...request, observation: observation("merchant-a", reason).snapshot() }) });
      await fixture.execute();
      const saved = fixture.saved[0].snapshot();
      assert.equal(saved.template.variant_a.system_prompt, baseline);
      assert.ok(saved.template.variant_b.system_prompt.startsWith(baseline));
      assert.doesNotMatch(saved.template.variant_b.system_prompt, /5%|\$100|loyalty discount|free shipping|encryption|guarantee/i);
      assert.equal(saved.expected_lift_percent, 0);
      assert.equal(saved.status, "pending_review");
    }
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("MI-V20: merchant context is read-only and refuses an invented baseline", async () => {
  const lookups: unknown[] = [];
  const context = new PrismaHypothesisMerchantContext({ merchantRule: { findUnique: async (where: unknown) => { lookups.push(where); return null; } } } as unknown as PrismaClient);
  assert.equal(await context.getRules("merchant-a"), undefined);
  assert.deepEqual(lookups, [{ where: { merchantId: "merchant-a" } }]);
  assert.equal(await context.getCurrentPrompt("merchant-a"), undefined);
});

test("MI-V20: malformed and over-cap model responses fall back to reviewed help only", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "local-test-key";
  try {
    for (const content of ["invalid JSON", JSON.stringify({}), JSON.stringify(proposal("Offer 95% discount"))]) {
      globalThis.fetch = async (_url, options) => {
        const request = JSON.parse(String(options?.body));
        assert.match(request.messages[0].content, /Max discount: 8%/);
        assert.match(request.messages[0].content, /Free shipping allowed: false/);
        assert.ok(request.messages[1].content.includes(baseline));
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      };
      const fixture = setup({ generate: (request) => new LLMHypothesisGenerator().generate(request) });
      await fixture.execute();
      assert.equal(fixture.saved[0].status, "pending_review");
      assert.equal(fixture.saved[0].template.variant_a.system_prompt, baseline);
      assert.doesNotMatch(fixture.saved[0].template.variant_b.system_prompt, /discount|95%/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("MI-V20: provider failure cannot invent an offer", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "local-test-key";
  globalThis.fetch = async () => { throw new Error("Simulated provider unavailable"); };
  try {
    const fixture = setup({ generate: (request) => new LLMHypothesisGenerator().generate(request) });
    await fixture.execute();
    assert.equal(fixture.saved[0].status, "pending_review");
    assert.equal(fixture.saved[0].template.variant_a.system_prompt, baseline);
    assert.doesNotMatch(fixture.saved[0].template.variant_b.system_prompt, /discount|loyalty|5%|\$100/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("MI-V20: persisted tenant limits are returned without creating defaults", async () => {
  const persisted = merchantRules(4, false);
  const lookups: unknown[] = [];
  const context = new PrismaHypothesisMerchantContext({ merchantRule: { findUnique: async (where: unknown) => { lookups.push(where); return persisted; } } } as unknown as PrismaClient);
  assert.deepEqual(await context.getRules("merchant-a"), persisted);
  assert.deepEqual(lookups, [{ where: { merchantId: "merchant-a" } }]);
});

test("MI-V15: discount rule creation and autoApprove cannot bypass merchant review", () => {
  const response = proposal();
  const rule = HypothesisEntity.create({ merchant_id: "merchant-a", observation_id: "observation-a", ...response,
    hypothesis_type: "discount_rule", risk_level: "low", approval_strategy: "auto" });
  assert.equal(rule.status, "pending_review");
  assert.equal(rule.approval_strategy, "manual");
  assert.throws(() => rule.autoApprove(), /HYPOTHESIS_COMMERCIAL_APPROVAL_REQUIRED/);
  assert.equal(rule.approve("merchant-user").status, "approved");
});
