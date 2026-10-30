import assert from "node:assert/strict";
import test from "node:test";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { createOrderHandlers } from "../tool-handlers/order.handlers.js";

const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 };
const input = { merchantId: "merchant", sessionId: "conversation", cartId: "conversation", storeCategory: "others",
  userMessage: "Qual o status do meu pedido ORDER-PAID?", history: [], buyerContext: { globalUserId: "buyer" } };
const classification = { intent: "ORDER_STATUS" as const, requiresTool: true, needsProductDiscovery: false };
const trackingCall = { id: "track", name: "track_order", args: { orderId: "ORDER-PAID" } };
const reply = JSON.stringify({ schemaVersion: 1, message: "O pagamento do pedido ORDER-PAID está aprovado. O rastreamento ainda não está disponível." });

for (const fallback of [false, true]) test(`paid status performs one owned read then narrates with tool_choice none (${fallback ? "fallback" : "primary"})`, async () => {
  const queries: any[] = [], requests: any[] = [];
  const canonical = createOrderHandlers({ prisma: {
    completedOrder: { findFirst: async (query: any) => {
      queries.push(query); assert.deepEqual(query.where, { merchantId: "merchant", externalOrderId: "ORDER-PAID", session: { globalUserId: "buyer" } });
      return { externalOrderId: "ORDER-PAID", status: "approved", completedAt: new Date("2026-10-30T21:03:37Z") };
    } }, shipment: { findFirst: async () => null },
  } as never }, { merchantId: "merchant", sessionId: "conversation", buyer: { globalUserId: "buyer" } });
  const provider = { chat: async (request: any) => {
    requests.push(request);
    return typeof request.toolChoice === "object" ? { content: "", toolCalls: [trackingCall], usage } : { content: reply, usage };
  } };
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: canonical as never,
    provider: fallback ? { chat: async () => { throw Error("primary_unavailable"); } } as never : provider as never,
    ...(fallback ? { fallbackProvider: provider as never } : {}) }, classification);
  const result = await agent.run(input);
  assert.equal(queries.length, 1); assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].toolChoice, { type: "function", function: { name: "track_order" } });
  assert.equal(requests[1].toolChoice, "none");
  assert.match(result.message, /aprovado/); assert.doesNotMatch(result.message, /Como posso ajudá-lo/);
  assert.equal(result.safetyValidation.safe, true); assert.deepEqual(result.toolsUsed, ["track_order"]);
});

test("a provider that violates tool_choice none cannot repeat the paid-order query", async () => {
  let reads = 0, calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: { trackOrder: async () => {
    reads++; return { found: true, orderId: "ORDER-PAID", status: "approved", statusLabel: "Pagamento aprovado", trackingAvailable: false };
  } } as never, provider: { chat: async () => { calls++; return { content: "", toolCalls: [trackingCall], usage }; } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(reads, 1); assert.equal(calls, 2); assert.deepEqual(result.toolsUsed, ["track_order"]);
  assert.doesNotMatch(result.message, /Como posso ajudá-lo/);
});

test("a failed first tracking read is never repeated or presented as approved", async () => {
  let reads = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: { trackOrder: async () => { reads++; throw Error("private_read_failure"); } } as never,
    provider: { chat: async (request: any) => typeof request.toolChoice === "object"
      ? { content: "", toolCalls: [trackingCall], usage } : { content: reply, usage } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(reads, 1); assert.equal(result.safetyValidation.safe, false); assert.doesNotMatch(result.message, /está aprovado/);
});
