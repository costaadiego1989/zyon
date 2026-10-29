import assert from "node:assert/strict";
import test from "node:test";
import { StorefrontRealtimeVoiceController } from "./storefront-realtime-voice.controller.js";
import { StorefrontConversationAdapter } from "../../infrastructure/adapters/storefront-conversation.adapter.js";
import { OpenAIRealtimeVoiceService } from "../../../../shared/openai/openai-realtime-voice.service.js";
import { StorefrontObserver } from "../../infrastructure/observability/storefront-observation.js";
import { STOREFRONT_OUT_OF_SCOPE_MESSAGE, STOREFRONT_SCOPE_CLARIFICATION_MESSAGE } from "../../domain/services/storefront-conversation-scope.js";

for (const domain of ["STORE_COMMERCE", "STORE_SUPPORT", "OUT_OF_SCOPE", "UNCLEAR"] as const) {
  test(`storefront voice binds server scope decision to authenticated call: ${domain}`, async () => {
    let captured: any; const requests: unknown[] = [];
    const controller = new StorefrontRealtimeVoiceController(
      { verify: () => ({ resourceId: "conversation_a", merchantId: "merchant_a", aiUserId: "visitor:a" }) } as never,
      { getOrCreate: async () => ({ items: [], total: 0, discount: 0 }) } as never,
      { findForMerchant: async () => undefined } as never,
      { assertAllowed: async () => undefined } as never,
      { createCall: async (value: any) => { captured = value; return { sdp: "answer" }; } } as never,
      { classifyConversationScope: async (value: unknown) => { requests.push(value); return domain; } },
    );
    await controller.createSession({ headers: { authorization: "Bearer synthetic" } }, "conversation_a", { sdp: "v=0\r\nsynthetic" });
    assert.equal(captured.surface, "storefront");
    assert.equal(captured.merchantId, "merchant_a");
    const input = { userMessage: "Explique Fibonacci", history: [] };
    const decision = await captured.checkScope(input);
    assert.deepEqual(requests, [input]);
    assert.deepEqual(decision, domain === "STORE_COMMERCE" || domain === "STORE_SUPPORT" ? { allowed: true }
      : { allowed: false, reason: domain === "OUT_OF_SCOPE" ? "out_of_scope" : "scope_unclear",
        message: domain === "OUT_OF_SCOPE" ? STOREFRONT_OUT_OF_SCOPE_MESSAGE : STOREFRONT_SCOPE_CLARIFICATION_MESSAGE });
  });
}
test("marked storefront voice cannot open provider call without a server scope checker", async t => {
  const previous = globalThis.fetch; let calls = 0;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => { calls++; throw new Error("must_not_send"); };
  const service = new OpenAIRealtimeVoiceService({} as never);
  await assert.rejects(service.createCall({ sdp: "v=0\r\nsynthetic", merchantId: "m", conversationId: "c", aiUserId: "visitor:a",
    surface: "storefront", cart: { items: [] } }), /voice_scope_checker_required/);
  assert.equal(calls, 0);
});
test("adapter voice scope reuses V2 classifier only, without main, tools or keyword routing", async () => {
  let calls = 0;
  const adapter = Object.create(StorefrontConversationAdapter.prototype);
  const events: unknown[] = [];
  Object.defineProperty(adapter, "observer", { value: new StorefrontObserver({ enabled: true, record: event => events.push(event) }) });
  Object.defineProperty(adapter, "copyProvider", { value: { model: "synthetic-model", async chat(request: any) {
    calls++; assert.equal(request.maxTokens, 220); assert.equal(request.tools, undefined);
    assert.equal(request.responseFormat.type, "json_object");
    return { content: JSON.stringify({ schemaVersion: 2, domain: "OUT_OF_SCOPE", intent: "COMPLEX_QUESTION", confidence: 0.98,
      requiresTool: false, needsProductDiscovery: false }), usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
  } } });
  assert.equal(await adapter.classifyConversationScope({ userMessage: "Explique Fibonacci", history: [] }), "OUT_OF_SCOPE");
  assert.equal(calls, 1);
  assert.ok(events.some((event: any) => event.kind === "decision" && event.reason === "out_of_scope"));
  assert.ok(!JSON.stringify(events).includes("Fibonacci"));
});

test("storefront cannot obtain an unguarded client secret instead of the server call", async t => {
  const previous = globalThis.fetch; let calls = 0;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => { calls++; throw new Error("must_not_send"); };
  const service = new OpenAIRealtimeVoiceService({} as never);
  await assert.rejects(service.createClientSecret({ merchantId: "m", conversationId: "c", surface: "storefront", cart: { items: [] } }), /voice_server_control_required/);
  assert.equal(calls, 0);
});
