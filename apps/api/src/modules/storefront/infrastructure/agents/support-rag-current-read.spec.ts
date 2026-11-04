import test from "node:test";
import assert from "node:assert/strict";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { createSupportHandlers } from "../tool-handlers/support.handlers.js";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const classification = { domain: "STORE_SUPPORT" as const, intent: "RETURN_REQUEST" as const, requiresTool: true, needsProductDiscovery: false };
const input = { merchantId: "merchant", sessionId: "owned", cartId: "owned", history: [], storeCategory: "others",
  userMessage: "Como peço uma troca ou devolução?", knowledgeContext: "Trecho recuperado: solicite ao atendimento." };
const text = "[MOCK] Informe o número do pedido e o motivo ao atendimento para receber as orientações de devolução.";
const faq = { faqs: [{ question: "Como pedir devolução?", answer: text }] };
const policies = { configured: true, policies: { returns: text } };
const reply = (message: string) => JSON.stringify({ schemaVersion: 1, message });

test("RAG support revalidates actual FAQ and policies before a tool-free answer and keeps its current-read gate", async () => {
  const reads: string[] = [];let modelCalls = 0, mutations = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    getFaq: async args => { assert.deepEqual(args, {});reads.push("faq");return faq; },
    getStorePolicies: async args => { assert.deepEqual(args, { policyType: "all" });reads.push("policies");return policies; },
    addItemToCart: async () => { mutations++;throw Error("unexpected mutation"); },
    escalateToHuman: async () => { mutations++;throw Error("unexpected mutation"); },
  } as never, provider: { chat: async params => {
    modelCalls++;assert.deepEqual(reads, ["faq", "policies"]);
    const evidence = params.messages.find(m => m.role === "system" && m.content?.includes('"id":"storefront.current-support-evidence"'));
    assert.ok(evidence);const current = JSON.parse(evidence.content!);
    assert.deepEqual(current.current, { faqs: faq, policies });
    return { content: reply(text), usage };
  } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(result.message, text);assert.equal(result.safetyValidation.safe, true);
  assert.deepEqual(result.toolsUsed, ["get_faq", "get_store_policies"]);
  assert.equal(modelCalls, 1);assert.equal(mutations, 0);
});

test("a RAG context string cannot authorize a support answer after failed or malformed current reads", async () => {
  for (const malformed of [false, true]) {
    let reads = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      getFaq: async () => { reads++;if (malformed) return { faqs: "invalid" };throw Error("unavailable"); },
      getStorePolicies: async () => { reads++;return { configured: true }; },
    } as never, provider: { chat: async () => ({ content: reply(text), usage }) } as never }, classification);
    const result = await agent.run(input);
    assert.equal(reads, 2);assert.equal(result.safetyValidation.safe, false);
    assert.equal(result.safetyValidation.reason, "required_read_unconfirmed");
    assert.match(result.message, /Não consegui confirmar/);
  }
});

test("provider fallback receives the same current support evidence without repeating reads", async () => {
  let reads = 0, primaryCalls = 0, fallbackCalls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    getFaq: async () => { reads++;return faq; }, getStorePolicies: async () => { reads++;return policies; },
  } as never, provider: { chat: async () => { primaryCalls++;throw Error("provider unavailable"); } } as never,
  fallbackProvider: { chat: async params => {
    fallbackCalls++;assert.equal(reads, 2);
    const evidence = params.messages.find(m => m.role === "system" && m.content?.includes('"id":"storefront.current-support-evidence"'));
    assert.ok(evidence);assert.deepEqual(JSON.parse(evidence.content!).current, { faqs: faq, policies });
    return { content: reply(text), usage };
  } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(primaryCalls, 1);assert.equal(fallbackCalls, 1);assert.equal(reads, 2);
  assert.equal(result.message, text);assert.equal(result.safetyValidation.safe, true);
});

test("a successful FAQ lookup cannot mask a failed policy read or the inverse", async () => {
  for (const failed of ["faq", "policies"]) {
    for (const format of ["malformed", "business_error"]) {
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      getFaq: async () => failed === "faq" ? format === "business_error" ? { error: "faq_unavailable" } : { faqs: "invalid" } : faq,
      getStorePolicies: async () => failed === "policies" ? format === "business_error" ? { error: "policies_unavailable" } : { configured: true } : policies,
    } as never, provider: { chat: async () => ({ content: reply(text), usage }) } as never }, classification);
    const result = await agent.run(input);
    assert.equal(result.safetyValidation.safe, false);assert.equal(result.safetyValidation.reason, "required_read_unconfirmed");
    assert.match(result.message, /Não consegui confirmar/);
    }
  }
});

test("the actual FAQ handler preserves a database outage through the agent current-read guard", async () => {
  let queries = 0, handoffs = 0;
  const support = createSupportHandlers({ prisma: { supportSetting: { findUnique: async (args: any) => {
    queries++;assert.equal(args.where.merchantId, "merchant");throw Error("database unavailable");
  } } }, supportHandoff: { createHandoff: async () => { handoffs++;throw Error("unexpected handoff"); } } } as never,
  { merchantId: "merchant", sessionId: "owned" });
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    ...support, getStorePolicies: async () => policies,
  } as never, provider: { chat: async () => ({ content: reply(text), usage }) } as never }, classification);
  const result = await agent.run(input);
  assert.equal(queries, 1);assert.equal(handoffs, 0);
  assert.equal(result.safetyValidation.safe, false);assert.equal(result.safetyValidation.reason, "required_read_unconfirmed");
  assert.match(result.message, /Não consegui confirmar/);
});

test("support preflight does not replace mandatory order reads or run on commerce and context-free turns", async () => {
  for (const change of [{ knowledgeContext: undefined }, { classification: { ...classification, domain: "STORE_COMMERCE" as const } },
    { classification: { ...classification, intent: "ORDER_STATUS" as const } }]) {
    let supportReads = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      getFaq: async () => { supportReads++;return faq; }, getStorePolicies: async () => { supportReads++;return policies; },
    } as never, provider: { chat: async () => ({ content: reply("Consulte o atendimento."), usage }) } as never }, change.classification ?? classification);
    await agent.run({ ...input, ...(Object.hasOwn(change, "knowledgeContext") ? { knowledgeContext: change.knowledgeContext } : {}) });
    assert.equal(supportReads, 0);
  }
});
