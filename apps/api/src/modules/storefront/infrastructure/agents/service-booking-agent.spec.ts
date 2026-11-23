import assert from "node:assert/strict";
import test from "node:test";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const input = { merchantId: "merchant", sessionId: "cart", cartId: "cart", storeCategory: "services", history: [],
  userMessage: "Quero escolher uma consulta com a Dra. Joana amanhã às dez" };
const classification = { schemaVersion: 2, domain: "STORE_COMMERCE", intent: "COMPLEX_QUESTION", confidence: 0.99,
  requiresTool: true, needsProductDiscovery: false, shoppingPhase: null, serviceRequest: "live_facts", serviceAction: "select" };
function fixture(action: "service" | "write" | "none" | "educational", bound = true) {
  const requests: any[] = [], serviceCalls: unknown[] = [], writes: unknown[] = [], callbacks: unknown[] = [];
  const handlers = { ...(bound ? { serviceBooking: { resolveServiceSelection: async (args: unknown) => { serviceCalls.push(args);
    return { kind: "authentication_required", action: "authenticate" }; } } } : {}), createCheckoutSession: async (args: unknown) => { writes.push(args); return {}; } };
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, fastModel: "fast", strongModel: "strong", toolHandlers: handlers,
    provider: { chat: async (request: any) => {
      requests.push(request);
      if (requests.length === 1) return { content: JSON.stringify(action === "educational" ? { ...classification, domain: "STORE_SUPPORT", serviceAction: null } : classification), usage };
      if (requests.length === 2 && action !== "none") return { content: "", usage, finishReason: "tool_calls", toolCalls: [{ id: "call1",
        name: action === "write" ? "create_checkout_session" : action === "educational" ? "get_current_service_facts" : "resolve_service_selection",
        args: action === "write" ? { cartId: "cart" } : action === "educational" ? {} : { productId: "service", variantId: "variant", professionalName: "Dra. Joana", date: { kind: "relative", value: "tomorrow" }, time: { kind: "exact", value: "10:00" } } }] };
      return { content: JSON.stringify({ schemaVersion: 1, message: "Agendamento confirmado e pagamento aprovado." }), usage, finishReason: "stop" };
    } } } as never);
  return { agent, requests, serviceCalls, writes, callbacks };
}
test("T43 actual agent operational branch", async t => {
  await t.test("an operational hint bypasses educational early-return and renders the typed authentication action without another narration", async () => {
    const f = fixture("service"); let educationalReads = 0;
    const prepared = await f.agent.prepare({ ...input, callbacks: { onToolResult: (...args: unknown[]) => { f.callbacks.push(args); } } });
    assert.equal(prepared.allowed, true); if (!prepared.allowed) assert.fail("valid operational turn expected");
    const result = await prepared.run({ groundedBusinessContext: true }, async () => { educationalReads++; return { status: "attached" }; });
    assert.equal(educationalReads, 0); assert.equal(f.serviceCalls.length, 1); assert.equal(f.requests.length, 2);
    assert.equal(result.blocks[0]?.type, "service_booking"); assert.equal((result.blocks[0] as any).data.action, "authenticate");
    assert.equal(result.message, "Entre na sua conta para consultar os horários e continuar o agendamento."); assert.equal(f.callbacks.length, 1);
  });
  await t.test("a semantic hint alone cannot advertise protected service handlers", async () => {
    const f = fixture("none", false), result = await f.agent.run(input);
    const names = (f.requests[1]?.tools ?? []).map((tool: any) => tool.function.name);
    assert.equal(names.includes("resolve_service_selection"), false); assert.deepEqual(f.serviceCalls, []);
    assert.equal(result.blocks.some(block => block.type === "service_booking"), false);
  });
  await t.test("educational live facts retain their previous mandatory read and do not reach booking tools", async () => {
    const f = fixture("educational"), prepared = await f.agent.prepare(input); assert.equal(prepared.allowed, true);
    if (!prepared.allowed) assert.fail("educational scope expected"); let reads = 0;
    const result = await prepared.run({ groundedBusinessContext: true }, async () => { reads++; return { status: "attached" }; });
    assert.equal(reads, 1); assert.deepEqual(f.serviceCalls, []); assert.equal(result.blocks.length, 0);
    assert.equal(result.message, "Vou conferir os dados atuais deste atendimento.");
  });
  await t.test("the operational allowlist refuses a model checkout write even when an old writer is present", async () => {
    const f = fixture("write"), result = await f.agent.run(input);
    assert.deepEqual(f.writes, []); const names = (f.requests[1]?.tools ?? []).map((tool: any) => tool.function.name);
    assert.equal(names.includes("create_checkout_session"), false); assert.equal(result.message.includes("pagamento aprovado"), false);
  });
  await t.test("unsubstantiated model confirmation is replaced by deterministic unconfirmed copy", async () => {
    const f = fixture("none"), result = await f.agent.run(input);
    assert.equal(result.message, "Ainda não consegui confirmar os horários. Tente consultar as opções novamente.");
    assert.equal(result.blocks.length, 0); assert.deepEqual(f.writes, []); assert.deepEqual(f.serviceCalls, []);
  });
});
