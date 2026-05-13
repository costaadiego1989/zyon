import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicConversationAdapter } from "./deterministic-conversation.adapter.js";

const adapter = new DeterministicConversationAdapter();

// ─── RED tests written before implementation ──────────────────────────────────

test("DeterministicConversationAdapter.reply never calls fetch", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    await adapter.reply({ userMessage: "esta caro", brandVoice: "consultative" });
    assert.equal(called, false, "must not call fetch");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeterministicConversationAdapter.reply returns objection price for price message", async () => {
  const result = await adapter.reply({ userMessage: "esta muito caro", brandVoice: "consultative" });
  assert.equal(result.objection, "price");
});

test("DeterministicConversationAdapter.reply returns objection shipping_cost for shipping message", async () => {
  const result = await adapter.reply({ userMessage: "frete caro", brandVoice: "consultative" });
  assert.equal(result.objection, "shipping_cost");
});

test("DeterministicConversationAdapter.reply uses data_collection stage template", async () => {
  const result = await adapter.reply({
    userMessage: "ok",
    brandVoice: "consultative",
    stage: "data_collection",
    missingFields: ["email"]
  });
  assert.ok(result.message.length > 0, "message returned");
});

test("DeterministicConversationAdapter.reply uses shipping stage template", async () => {
  const result = await adapter.reply({
    userMessage: "ok",
    brandVoice: "consultative",
    stage: "shipping",
    missingFields: ["CEP"]
  });
  assert.match(result.message, /CEP/i);
});

test("DeterministicConversationAdapter.reply uses payment stage template", async () => {
  const result = await adapter.reply({
    userMessage: "ok",
    brandVoice: "consultative",
    stage: "payment"
  });
  assert.ok(result.message.length > 0);
});

test("DeterministicConversationAdapter.reply mentions approved offer", async () => {
  const result = await adapter.reply({
    userMessage: "quero desconto",
    brandVoice: "consultative",
    authorizedOffer: {
      id: "off_1",
      merchantId: "mrc_1",
      sessionId: "chk_1",
      type: "discount_percent",
      value: 10,
      approved: true,
      reason: "discount_allowed",
      marginAfterOffer: 0.5,
      expiresAt: "2999-01-01T00:00:00.000Z"
    }
  });
  assert.match(result.message, /10%/);
});

test("DeterministicConversationAdapter.reply includes agent name prefix when agentContext provided", async () => {
  const result = await adapter.reply({
    userMessage: "ok",
    brandVoice: "consultative",
    stage: "payment",
    agentContext: {
      merchant_id: "mrc_1",
      agent_id: "agent_1",
      agent: {
        agentName: "Nina",
        persona: "checkout sales agent",
        tone: "consultative",
        language: "pt-BR",
        greeting: "Oi!"
      },
      capabilities: {
        priceObjectionHandling: true,
        shippingObjectionHandling: true,
        trustReassurance: true,
        paymentFrictionGuidance: true,
        escalation: true,
        machineToMachineNegotiation: false
      },
      guardrails: {
        forbidUnauthorizedDiscounts: true,
        forbidUnauthorizedFreeShipping: true,
        forbidDeliveryPromisesWithoutSource: true,
        forbidStockPromisesWithoutSource: true,
        forbidPaymentStatusClaims: true,
        forbidLegalMedicalFinancialAdvice: true,
        forbidAbusivePressure: true,
        blockedPhrases: [],
        requiredDisclaimers: [],
        escalationTriggers: []
      },
      checkout_settings: {
        agentMode: "silent_until_trigger",
        openWidgetOnTrigger: true,
        cooldownSeconds: 120,
        maxInterventionsPerSession: 3,
        triggerPreferences: [],
        handoffEnabled: true
      },
      copy_constraints: []
    }
  });
  assert.match(result.message, /Nina:/);
});
