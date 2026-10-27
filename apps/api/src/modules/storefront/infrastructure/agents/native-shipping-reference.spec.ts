import assert from "node:assert/strict";
import test from "node:test";
import { nativeShippingReferenceCep, resolveNativeShippingReference } from "./native-shipping-reference.js";
import { StorefrontConversationAdapter } from "../adapters/storefront-conversation.adapter.js";

const message = "Calcular frete para Produto apresentado CEP 01310-100";
const input = { merchantId: "merchant", sessionId: "conversation", cartId: "owned-cart", userMessage: message, history: [], storeCategory: "others" };
const reference = () => ({ referenceOnly: true, reference: { id: "00000000-0000-4000-8000-000000000001", expiresAt: "2026-12-01T12:00:00Z",
  basisHash: "a".repeat(64), configurationHash: "b".repeat(64), destinationZip: "01310100", addressSource: "requested_cep" },
  options: [{ carrier: "melhor-envio-1", name: "Correios PAC", price: 1840, days: 5, zipCode: "01310100" }] });

test("the native CEP form quotes the bound cart exactly once with only a normalized CEP", async () => {
  let calls = 0;
  const result = await resolveNativeShippingReference(input, async args => { calls++; assert.deepEqual(args, { zipCode: "01310100" }); return reference(); });
  assert.equal(calls, 1); assert.equal(result?.cartId, "owned-cart");
  assert.equal(result?.blocks[0]?.type, "shipping_options");
  assert.match(JSON.stringify(result), /18,40/);
  assert.doesNotMatch(result!.message, /CEP de entrega\?|confirmar a resposta/);
});

test("unrelated prose, negative requests and invalid CEPs never invoke the native quote", async () => {
  for (const value of ["Não " + message, "Explique " + message, "01310100", "Calcular frete para Produto CEP 00000-000", "Calcular frete para Produto CEP 01310-100 e altere o carrinho"]) {
    assert.equal(nativeShippingReferenceCep(value), undefined);
    assert.equal(await resolveNativeShippingReference({ ...input, userMessage: value }, async () => assert.fail("quote_must_not_run")), undefined);
  }
});

test("an unavailable cart returns its prerequisite without inventing rates or adding an item", async () => {
  const result = await resolveNativeShippingReference(input, async () => ({ referenceOnly: true, options: [], reason: "cart_empty" }));
  assert.deepEqual(result?.blocks, []); assert.match(result!.message, /variação.*carrinho/);
});

test("legacy fake results and uncertain provider failures are never repaired or retried", async () => {
  for (const value of [{ options: [{ carrier: "fake", name: "Fake", price: 500, days: 2 }] }, null]) {
    let calls = 0;
    const result = await resolveNativeShippingReference(input, async () => { calls++; if (value === null) throw Error("private_provider_failure"); return value; });
    assert.equal(calls, 1); assert.deepEqual(result?.blocks, []); assert.doesNotMatch(JSON.stringify(result), /Fake|500|private_provider/);
  }
});

for (const allowed of [false, true]) test(`the adapter preserves semantic admission before the native form: ${allowed}`, async () => {
  let classifications = 0, quotes = 0;
  const adapter = Object.assign(Object.create(StorefrontConversationAdapter.prototype), {
    structuredRouting: true, emitFunnelEvent: async () => {},
    agent: { prepare: async () => { classifications++; return allowed
      ? { allowed: true, run: async () => assert.fail("native form must not invoke sales generation") }
      : { allowed: false, result: { message: "Scope rejected" } }; } },
    handlerDeps: { prisma: {}, shippingReference: { quote: async (scope: unknown, request: unknown) => {
      quotes++; assert.deepEqual(scope, { merchantId: "merchant", cartId: "owned-cart", conversationId: "conversation" });
      assert.deepEqual(request, { zipCode: "01310100" }); return reference();
    } } },
  }) as StorefrontConversationAdapter;
  const result = await adapter.reply(input);
  assert.equal(classifications, 1); assert.equal(quotes, allowed ? 1 : 0);
  assert.equal(result.blocks.length, allowed ? 1 : 0);
});
