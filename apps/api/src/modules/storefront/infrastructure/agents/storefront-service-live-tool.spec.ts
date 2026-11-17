import assert from "node:assert/strict";
import test from "node:test";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";

const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 };
const request = { productId: "service", professionalId: "professional", fromDate: "2026-11-18", toDate: "2026-11-19" };
const input = { merchantId: "merchant", sessionId: "session", userMessage: "Qual o valor e os horários desse serviço?",
  history: [], storeCategory: "services" };

test("T71 fixed live tool is announced and executable only with the private service callback", async () => {
  let classifications = 0, calls = 0, reads = 0;
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { async chat(value: any) {
    const prompt = JSON.parse(value.messages[0].content);
    if (prompt.id === "storefront.intent") {
      classifications++;
      return { content: JSON.stringify({ schemaVersion: 2, domain: "STORE_SUPPORT", intent: "COMPLEX_QUESTION",
        confidence: 0.99, requiresTool: true, needsProductDiscovery: false, serviceRequest: "live_facts" }), usage };
    }
    calls++;
    assert.deepEqual(value.tools.map((tool: any) => tool.function.name), ["get_current_service_facts"]);
    return { content: "", toolCalls: [{ id: "read", name: "get_current_service_facts", args: request }], usage };
  } } as never, toolHandlers: { async getFaq() { assert.fail("unfenced_faq_tool"); },
    async getStorePolicies() { assert.fail("unfenced_policy_tool"); } } as never });
  const prepared = await agent.prepare(input);
  assert.equal(prepared.allowed, true); if (!prepared.allowed) assert.fail("scope_required");
  assert.equal(prepared.serviceRequest, "live_facts");
  const output = await prepared.run({ groundedBusinessContext: true, knowledgeContext: "QUOTED_PUBLIC_SOURCES" }, async value => {
    reads++; assert.deepEqual(value, request); return { status: "attached" };
  });
  assert.equal(classifications, 1); assert.equal(reads, 1); assert.equal(calls, 1);
  assert.deepEqual(output.toolsUsed, ["get_current_service_facts"]);
});

test("T71 body context cannot supply a live callback and product turns keep the existing tool set", async () => {
  let generation = 0;
  const agent = new StorefrontLangGraphAgent({ provider: { async chat() {
    return { content: JSON.stringify({ schemaVersion: 2, domain: "STORE_SUPPORT", intent: "COMPLEX_QUESTION",
      confidence: 0.99, requiresTool: false, needsProductDiscovery: false }), usage };
  } } as never, toolHandlers: {} as never });
  Object.defineProperty(agent, "runTurn", { value: async (_input: unknown, _semantic: unknown, callback: unknown) => {
    generation++; assert.equal(callback, undefined); return { message: "Existing product response", blocks: [] };
  } });
  const prepared = await agent.prepare(input); if (!prepared.allowed) assert.fail("scope_required");
  await assert.rejects(prepared.run({ serviceRead: async () => ({ status: "attached" }) } as never));
  assert.equal(generation, 0);
});
