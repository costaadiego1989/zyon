import assert from "node:assert/strict";
import test from "node:test";
import { StorefrontRealtimeVoiceController } from "./storefront-realtime-voice.controller.js";

test("product narration verifies the conversation and never loads cart commerce context", async () => {
  const calls: unknown[] = [];
  const controller = new StorefrontRealtimeVoiceController(
    { verify: () => ({ resourceId: "conversation_1", merchantId: "merchant_1", aiUserId: "visitor:user_1" }) } as never,
    { getOrCreate: async () => { throw new Error("narration_must_not_load_cart"); } } as never,
    {} as never,
    { assertAllowed: async (...input: unknown[]) => { calls.push(input); } } as never,
    {
      createProductNarrationCall: async (input: unknown) => {
        calls.push(input);
        return { sdp: "v=0\r\na=answer" };
      },
    } as never,
  );

  const response = await controller.createProductNarration(
    { headers: { authorization: "Bearer conversation-capability", origin: "https://store.example" } },
    "conversation_1",
    { sdp: "v=0\r\na=offer", summary: "  Sérum  capilar   para   barreira  " },
  );

  assert.equal(response.sdp, "v=0\r\na=answer");
  assert.deepEqual(calls, [
    ["merchant_1", { kind: "feature", key: "voiceCheckout" }],
    { merchantId: "merchant_1", conversationId: "conversation_1", sdp: "v=0\r\na=offer", aiUserId: "visitor:user_1", origin: "https://store.example", summary: "Sérum capilar para barreira" },
  ]);
});

test("product narration rejects an absent summary before creating a provider session", async () => {
  const controller = new StorefrontRealtimeVoiceController(
    { verify: () => ({ resourceId: "conversation_1", merchantId: "merchant_1", aiUserId: "visitor:user_1" }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(
    controller.createProductNarration(
      { headers: { authorization: "Bearer conversation-capability", origin: "https://store.example" } },
      "conversation_1",
      {},
    ),
    /product_summary_required/,
  );
});
