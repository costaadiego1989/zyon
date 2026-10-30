import assert from "node:assert/strict";
import test from "node:test";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { createOrderHandlers } from "../tool-handlers/order.handlers.js";
import { buildExecutableStoreTools, buildStoreTools } from "../../domain/tools/store-tools.js";
import { TRACK_ORDER } from "../../domain/tools/definitions/track-order.tool.js";

const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 };
const reply = (message: string) => JSON.stringify({ schemaVersion: 1, message });
const input = { merchantId: "merchant", sessionId: "owned", cartId: "owned", storeCategory: "others",
  userMessage: "Qual é o status do meu pedido?", history: [] };
const classification = { intent: "ORDER_STATUS" as const, requiresTool: true, needsProductDiscovery: false };
const call = { id: "track", name: "track_order", args: {} };

test("track_order advertises an optional order id and executes the existing no-IO clarification", async () => {
  let io = 0;
  const prisma = new Proxy({}, { get() { io++; throw Error("no_database_access_without_order_id"); } });
  const handlers = createOrderHandlers({ prisma: prisma as never }, { merchantId: "merchant", sessionId: "owned" });
  const tool = buildExecutableStoreTools({ merchantId: "merchant", sessionId: "owned", handlers: handlers as never })
    .find(value => value.name === "track_order")!;
  const result = await tool.execute({});
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, { found: false, message: "Informe o número do pedido para consultar o rastreamento." });
  assert.equal(io, 0);
  for (const definition of [TRACK_ORDER, buildStoreTools().find(value => value.name === "track_order")!])
    assert.equal((definition.parameters.required ?? []).includes("orderId"), false);
});

test("ORDER_STATUS owns one forced track read and returns the missing-id question without extra narration", async () => {
  for (const requiresTool of [true, false]) {
    const requests: any[] = []; let reads = 0, io = 0, writes = 0;
    const prisma = new Proxy({}, { get() { io++; throw Error("no_database_access_without_order_id"); } });
    const canonical = createOrderHandlers({ prisma: prisma as never }, { merchantId: "merchant", sessionId: "owned" });
    const agent = createAllowedScopeAgent({ structuredRouting: true,
      toolHandlers: { trackOrder: async (args: any) => { reads++; return canonical.trackOrder(args); },
        createQuestion: async () => { writes++; } } as never,
      provider: { chat: async (request: any) => {
        requests.push(request);
        if (requests.length === 1) return { content: reply("Posso consultar seu pedido?"), usage };
        assert.equal(requests.length, 2, "a canonical clarification terminates the turn");
        return request.toolChoice ? { content: "", toolCalls: [call, { ...call, id: "repeat" }], usage } : { content: reply("Posso consultar?"), usage };
      } } as never }, { ...classification, requiresTool });
    const result = await agent.run(input);
    assert.equal(reads, 1); assert.equal(io, 0); assert.equal(writes, 0); assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].toolChoice, { type: "function", function: { name: "track_order" } });
    assert.deepEqual(requests[1].tools.map((tool: any) => tool.function.name), ["track_order"]);
    assert.equal(result.message, "Informe o número do pedido para consultar o rastreamento.");
    assert.equal(result.safetyValidation.safe, true); assert.deepEqual(result.blocks, []);
    assert.deepEqual(result.toolsUsed, ["track_order"]); assert.equal(agent.outputReviewRequests.length, 0);
  }
});

test("a direct no-id track tool call terminates once without repeated reads or model calls", async () => {
  let calls = 0, reads = 0;
  const canonical = createOrderHandlers({ prisma: new Proxy({}, { get() { throw Error("no_io"); } }) as never }, input);
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { trackOrder: async (args: any) => { reads++; return canonical.trackOrder(args); } } as never,
    provider: { chat: async () => { assert.equal(++calls, 1); return { content: "", toolCalls: [call, { ...call, id: "repeat" }], usage }; } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(calls, 1); assert.equal(reads, 1); assert.match(result.message, /Informe o número do pedido/);
});

test("an unexpected write in the forced order read is rejected and cannot become read evidence", async () => {
  let calls = 0, writes = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { createQuestion: async () => { writes++; return { id: "unexpected" }; } } as never,
    provider: { chat: async () => { calls++; return calls === 2 ? { content: "", toolCalls: [{ id: "write", name: "create_question",
      args: { productId: "product", question: "Not requested", authorName: "Buyer" } }], usage }
      : { content: reply("Sua pergunta foi enviada."), usage }; } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(writes, 0); assert.equal(result.safetyValidation.safe, false); assert.deepEqual(result.toolsUsed, []);
  assert.doesNotMatch(result.message, /Sua pergunta foi enviada/);
});

test("malformed tracking arguments and unavailable providers fail honestly without IO or invented order status", async () => {
  for (const failure of ["malformed", "provider", "read", "ignored"] as const) {
    let calls = 0, reads = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true,
      toolHandlers: { trackOrder: async () => { reads++; throw Error("PRIVATE_READ_FAILURE"); } } as never,
      provider: { chat: async () => {
        calls++;
        if (calls === 2 && failure === "provider") throw Error("PRIVATE_PROVIDER_FAILURE");
        if (calls === 2 && failure !== "ignored") return { content: "", toolCalls: [{ ...call,
          args: failure === "malformed" ? { orderId: 123, merchantId: "foreign" } : {} }], usage };
        return { content: reply("Seu pedido está entregue."), usage };
      } } as never }, classification);
    const result = await agent.run(input);
    assert.equal(reads, failure === "read" ? 1 : 0); assert.equal(result.safetyValidation.safe, false); assert.deepEqual(result.blocks, []);
    assert.doesNotMatch(result.message, /PRIVATE_|Seu pedido está entregue/);
  }
});

test("malformed main JSON is not repaired or retried for order status", async () => {
  let calls = 0, reads = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { trackOrder: async () => { reads++; } } as never,
    provider: { chat: async () => { calls++; return { content: "not-json", usage }; } } as never }, classification);
  await agent.run(input); assert.equal(calls, 1); assert.equal(reads, 0);
});

test("fallback provider no-id tracking also ends at the canonical clarification", async () => {
  let primary = 0, fallback = 0, reads = 0;
  const canonical = createOrderHandlers({ prisma: new Proxy({}, { get() { throw Error("no_io"); } }) as never }, input);
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { trackOrder: async (args: any) => { reads++; return canonical.trackOrder(args); } } as never,
    provider: { chat: async () => { primary++; throw Error("provider_unavailable"); } } as never,
    fallbackProvider: { chat: async () => { assert.equal(++fallback, 1); return { content: "", toolCalls: [call], usage }; } } as never,
  }, classification);
  const result = await agent.run(input);
  assert.equal(primary, 1); assert.equal(fallback, 1); assert.equal(reads, 1);
  assert.equal(result.message, "Informe o número do pedido para consultar o rastreamento.");
  assert.equal(result.safetyValidation.safe, true); assert.equal(agent.outputReviewRequests.length, 0);
});
