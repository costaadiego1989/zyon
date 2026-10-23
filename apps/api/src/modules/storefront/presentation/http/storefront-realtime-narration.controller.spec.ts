import assert from "node:assert/strict";
import test from "node:test";
import { StorefrontRealtimeVoiceController } from "./storefront-realtime-voice.controller.js";

test("product narration verifies the conversation and never loads cart commerce context", async () => {
  const calls: unknown[] = [];
  const controller = new StorefrontRealtimeVoiceController(
    { verify: () => ({ resourceId: "conversation_1", merchantId: "merchant_1", aiUserId: "visitor:user_1" }) } as never,
    { getOrCreate: async () => { throw new Error("narration_must_not_load_cart"); } } as never,
    { findForMerchant: async () => assert.fail("narration_must_not_load_agent_identity") },
    { assertAllowed: async (...input: unknown[]) => { calls.push(input); } } as never,
    {
      createProductNarrationCall: async (input: unknown) => {
        calls.push(input);
        return { sdp: "v=0\r\nsynthetic-answer" };
      },
    } as never,
    undefined,
    { product: { findFirst: async () => ({ id: "product_1", merchantId: "merchant_1", name: "Sérum capilar para barreira",
      description: null, isActive: true, deletedAt: null }) } } as never,
  );

  const response = await controller.createProductNarration(
    { headers: { authorization: "Bearer conversation-capability", origin: "https://store.example" } },
    "conversation_1",
    { productId: "product_1", summary: "  Sérum  capilar   para   barreira  ", sdp: "v=0\r\nsynthetic-offer" },
  );

  assert.equal(response.sdp, "v=0\r\nsynthetic-answer");
  assert.deepEqual(calls, [
    ["merchant_1", { kind: "feature", key: "voiceCheckout" }],
    { merchantId: "merchant_1", conversationId: "conversation_1", summary: "Sérum capilar para barreira.",
      sdp: "v=0\r\nsynthetic-offer", aiUserId: "visitor:user_1", origin: "https://store.example" },
  ]);
});

test("product narration rejects absent canonical product/SDP before creating a provider session", async () => {
  const controller = new StorefrontRealtimeVoiceController(
    { verify: () => ({ resourceId: "conversation_1", merchantId: "merchant_1" }) } as never,
    {} as never,
    { findForMerchant: async () => assert.fail("invalid_narration_must_not_load_agent_identity") },
    {} as never,
    {} as never,
  );
  await assert.rejects(
    controller.createProductNarration(
      { headers: { authorization: "Bearer conversation-capability", origin: "https://store.example" } },
      "conversation_1",
      {},
    ),
    /invalid_product_narration_input/,
  );
});
