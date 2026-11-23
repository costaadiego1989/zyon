import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { StorefrontConversationAdapter } from "./storefront-conversation.adapter.js";
import type { StorefrontConversationInput } from "../../domain/ports/conversation.port.js";
import type { ServiceBookingHandlers } from "../../domain/ports/service-booking-tools.port.js";

const input: StorefrontConversationInput = { merchantId: "merchant", sessionId: "cart", cartId: "cart", history: [],
  userMessage: "Quero consultar horários de atendimento", storeCategory: "services" };
const auth = { kind: "authentication_required", action: "authenticate" } as const;
const tools: ServiceBookingHandlers = { getServiceProfessionals: async () => auth, getServiceDates: async () => auth,
  getServiceSlots: async () => auth, resolveServiceSelection: async () => auth };
function fixture(t: TestContext, serviceAction?: "browse" | "select" | null, allowed = true) {
  for (const [name, value] of Object.entries({ STOREFRONT_SEMANTIC_ROUTING: "structured", LOCAL_LLM_API_KEY: "synthetic-no-network",
    STOREFRONT_LLM_OBSERVABILITY: "disabled" })) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const calls: string[] = [], late: unknown[] = [];
  const denied = (label: string): any => new Proxy({}, { get(_target, key) { assert.fail("unexpected dependency: " + label + "." + String(key)); } });
  const prisma = new Proxy({}, { get(_target, key) { if (key === "storefrontWishlistItem") return denied("wishlist"); return denied("prisma." + String(key)); } });
  const adapter = new StorefrontConversationAdapter(denied("merchant"), denied("product"), denied("stock"), denied("cart"), prisma as never, denied("support"));
  const result = { message: "Entre na sua conta para continuar.", blocks: [{ type: "service_booking", data: auth }], toolsUsed: [], cartId: "cart",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, routing: { source: "structured", intent: "COMPLEX_QUESTION", confidence: 1,
      needsProductDiscovery: false, modelTier: "strong", modelUsed: "synthetic" }, safetyValidation: { safe: true } };
  Object.defineProperty(adapter, "agent", { value: { async prepare() { calls.push("prepare");
    return allowed ? { allowed: true, serviceAction, serviceRequest: "live_facts", async run(context: unknown) {
      calls.push("run"); late.push(context); return result;
    } } : { allowed: false, result: { ...result, blocks: [], message: "Escolha uma dúvida sobre a loja." } };
  } } });
  Object.defineProperty(adapter, "queryKnowledge", { value: { async openBusinessAnswer() { calls.push("business-rag"); return { kind: "unavailable" }; } } });
  Object.defineProperty(adapter, "copyService", { value: denied("copy") });
  Object.defineProperty(adapter, "telemetry", { value: { async recordEvent() {} } });
  return { adapter, calls, late };
}
test("T43 adapter service isolation", async t => {
  for (const action of ["browse", "select"] as const) await t.test("private " + action + " branch bypasses educational early-return and checkout decoration", async t => {
    const f = fixture(t, action); let captured: unknown;
    const output = await f.adapter.reply(input, undefined, undefined, async binding => { captured = binding; return tools; });
    assert.deepEqual(captured, { merchantId: "merchant", conversationId: "cart", cartRef: "cart" });
    assert.deepEqual(f.calls, ["prepare", "run"]); assert.deepEqual(f.late, [{}]);
    assert.deepEqual(output.blocks, [{ type: "service_booking", data: auth }]); assert.deepEqual(output.suggestedNext, ["Menu principal"]);
    assert.equal(output.message, "Entre na sua conta para continuar.");
  });
  await t.test("educational live facts retain the governed business RAG path", async t => {
    const f = fixture(t, null), output = await f.adapter.reply(input, undefined, undefined, async () => tools);
    assert.deepEqual(f.calls, ["prepare", "business-rag"]); assert.deepEqual(output.blocks, []); assert.deepEqual(f.late, []);
  });
  await t.test("an operational hint without a private binding cannot bypass governed RAG", async t => {
    const f = fixture(t, "select"), output = await f.adapter.reply(input);
    assert.deepEqual(f.calls, ["prepare", "business-rag"]); assert.deepEqual(output.blocks, []); assert.deepEqual(f.late, []);
  });
  await t.test("an opaque domain refusal still terminates before RAG, tools and checkout", async t => {
    const f = fixture(t, "select", false); let bindings = 0;
    const output = await f.adapter.reply(input, undefined, undefined, async () => { bindings++; return tools; });
    assert.deepEqual(f.calls, ["prepare"]); assert.deepEqual(f.late, []); assert.deepEqual(output.blocks, []);
    assert.equal(bindings, 0);
    assert.equal(output.message, "Escolha uma dúvida sobre a loja.");
  });
});
