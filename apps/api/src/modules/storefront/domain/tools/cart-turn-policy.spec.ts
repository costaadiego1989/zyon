import test from "node:test";
import assert from "node:assert/strict";
import { createCartTurnPolicy } from "./cart-turn-policy.js";

test("vague shopping cannot authorize an arbitrary add, coupon or checkout, even with stale UI metadata", async () => {
  for (const message of ["quero comprar um produto", "Quero comprar algo", "Quero comprar algo [variantId:stale]"]) {
    let writes = 0;
    const tools = createCartTurnPolicy(message).wrap(["add_item_to_cart", "apply_coupon", "create_checkout_session"].map(name => ({
      name, execute: async () => { writes++; return { ok: true as const, data: {} }; },
    })));
    for (const tool of tools) {
      const result = await tool.execute({ variantId: "stale", quantity: 1 });
      assert.equal(result.ok, false);
    }
    assert.equal(writes, 0);
  }
});

test("explicit purchases and selected UI commands keep their existing one-write contract", async () => {
  for (const message of ["Quero comprar este produto", "Comprar Sérum de Barreira", "Adicionar produto ao carrinho [variantId:chosen]"]) {
    let writes = 0;
    const policy = createCartTurnPolicy(message, undefined, "qa_cart");
    const [tool] = policy.wrap([{ name: "add_item_to_cart", execute: async () => {
      writes++;
      return { ok: true as const, data: { cartId: "qa_cart", items: [{ variantId: "chosen", quantity: 1 }] } };
    } }]);
    assert.equal((await tool!.execute({ variantId: "chosen", quantity: 1 })).ok, true, message);
    assert.equal((await tool!.execute({ variantId: "chosen", quantity: 1 })).ok, true, message);
    assert.equal(writes, 1, "a provider retry must not duplicate an admitted write");
    assert.equal(policy.addOutcomes[0]?.status, "succeeded");
  }
});

test("negation, comparisons and unconfirmed attachments never acquire write permission", async () => {
  for (const [message, attachment] of [["Não quero comprar este produto", undefined], ["Estou comparando produtos", undefined],
    ["Comprar Sérum de Barreira", "Lista extraída do comprador"]] as const) {
    const [tool] = createCartTurnPolicy(message, attachment).wrap([{ name: "add_item_to_cart", execute: async () => assert.fail("unauthorized write") }]);
    assert.equal((await tool!.execute({ variantId: "chosen", quantity: 1 })).ok, false);
  }
});
