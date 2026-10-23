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

const projectedLine = (variantId = "chosen", quantity = 2, optionItemIds?: string[], serviceSlotId?: string | null) => ({
  variantId, name: "Produto", quantity, unitPrice: 10, lineTotal: quantity * 10,
  ...(optionItemIds ? { optionItemIds } : {}), ...(serviceSlotId !== undefined ? { serviceSlotId } : {}),
});
const projectedCart = (items = [projectedLine()], cartId = "actual-cart") => ({ cartId, items,
  itemCount: items.reduce((sum, item) => sum + item.quantity, 0), total: items.reduce((sum, item) => sum + item.lineTotal, 0) });

for (const name of ["update_cart_item", "remove_cart_item"] as const) {
  test(`${name} canonical correlated outcome becomes terminal without duplicate execution`, async () => {
    let writes = 0;
    const policy = createCartTurnPolicy(name === "update_cart_item" ? "Altere a quantidade no carrinho" : "Remova o produto do carrinho", undefined, "actual-cart");
    const args = { cartId: "actual-cart", variantId: "chosen", ...(name === "update_cart_item" ? { quantity: 2 } : {}) };
    const [tool] = policy.wrap([{ name, execute: async () => { writes++; return { ok: true as const,
      data: projectedCart(name === "update_cart_item" ? [projectedLine()] : [projectedLine("sibling")]) }; } }]);
    assert.equal((await tool!.execute(args)).ok, true);
    assert.equal(policy.terminal, true); assert.equal(policy.mutationOutcome?.status, "succeeded");
    await tool!.execute(args); assert.equal(writes, 1);
  });
  test(`${name} malformed/foreign/negative/unknown results never acknowledge success`, async () => {
    for (const result of [projectedCart(undefined, "foreign"), { ...projectedCart(), total: -1 },
      { error: "database_unknown" }, name === "update_cart_item" ? projectedCart([projectedLine("other")]) : projectedCart(),
      { ...projectedCart(), success: false }]) {
      const policy = createCartTurnPolicy(name === "update_cart_item" ? "Altere a quantidade no carrinho" : "Remova o produto do carrinho", undefined, "actual-cart");
      const [tool] = policy.wrap([{ name, execute: async () => ({ ok: true as const, data: result }) }]);
      const value = await tool!.execute({ cartId: "actual-cart", variantId: "chosen", ...(name === "update_cart_item" ? { quantity: 2 } : {}) });
      assert.equal(value.ok, false); assert.equal(policy.terminal, true); assert.equal(policy.mutationOutcome?.status, "unknown");
      assert.equal(policy.hasUnknownWrite, true);
    }
  });
  test(`${name} foreign command refuses before write`, async () => {
    let writes = 0;
    const policy = createCartTurnPolicy(name === "update_cart_item" ? "Altere a quantidade no carrinho" : "Remova o produto do carrinho", undefined, "actual-cart");
    const [tool] = policy.wrap([{ name, execute: async () => { writes++; return { ok: true as const, data: projectedCart() }; } }]);
    assert.equal((await tool!.execute({ cartId: "foreign", variantId: "chosen", ...(name === "update_cart_item" ? { quantity: 2 } : {}) })).ok, false);
    assert.equal(writes, 0); assert.equal(policy.mutationOutcome?.status, "rejected");
  });
  test(`${name} thrown uncertain write terminates once without leaking the error`, async () => {
    let writes = 0;
    const policy = createCartTurnPolicy(name === "update_cart_item" ? "Altere a quantidade no carrinho" : "Remova o produto do carrinho", undefined, "actual-cart");
    const [tool] = policy.wrap([{ name, execute: async () => { writes++; throw Error("PRIVATE_ACK_LOST"); } }]);
    const args = { cartId: "actual-cart", variantId: "chosen", ...(name === "update_cart_item" ? { quantity: 2 } : {}) };
    const result = await tool!.execute(args); await tool!.execute(args);
    assert.equal(writes, 1); assert.equal(policy.mutationOutcome?.status, "unknown"); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ACK_LOST/);
  });
}
test("exact selected option/slot and quantity correlation, not matching variant alone", async () => {
  for (const [items, succeeded] of [
    [[projectedLine("chosen", 2, ["large"], "slot")], true],
    [[projectedLine("chosen", 1, ["large"], "slot")], false],
    [[projectedLine("chosen", 2, ["small"], "slot")], false],
    [[projectedLine("chosen", 2, ["large"], "other-slot")], false],
    [[projectedLine("chosen", 2, ["large"], "slot"), projectedLine("chosen", 2, ["large"], "slot")], false],
  ] as const) {
    const policy = createCartTurnPolicy("Altere a quantidade no carrinho", undefined, "actual-cart");
    const [tool] = policy.wrap([{ name: "update_cart_item", execute: async () => ({ ok: true as const, data: projectedCart([...items]) }) }]);
    await tool!.execute({ cartId: "actual-cart", variantId: "chosen", quantity: 2, optionItemIds: ["large"], serviceSlotId: "slot" });
    assert.equal(policy.mutationOutcome?.status, succeeded ? "succeeded" : "unknown");
  }
});
test("update-zero/remove explicit selection allows only absent target, not absence of all variant siblings", async () => {
  for (const name of ["update_cart_item", "remove_cart_item"] as const) {
    const policy = createCartTurnPolicy(name === "update_cart_item" ? "Altere a quantidade no carrinho" : "Remova o produto do carrinho", undefined, "actual-cart");
    const [tool] = policy.wrap([{ name, execute: async () => ({ ok: true as const, data: projectedCart([projectedLine("chosen", 1, ["small"])]) }) }]);
    await tool!.execute({ cartId: "actual-cart", variantId: "chosen", optionItemIds: ["large"], ...(name === "update_cart_item" ? { quantity: 0 } : {}) });
    assert.equal(policy.mutationOutcome?.status, "succeeded");
  }
});
test("a handler cannot change the captured quantity while executing and acknowledge its substituted result", async () => {
  const policy = createCartTurnPolicy("Altere a quantidade no carrinho", undefined, "actual-cart");
  const [tool] = policy.wrap([{ name: "update_cart_item", execute: async args => { args.quantity = 3;
    return { ok: true as const, data: projectedCart([projectedLine("chosen", 3)]) }; } }]);
  await tool!.execute({ cartId: "actual-cart", variantId: "chosen", quantity: 2 });
  assert.equal(policy.mutationOutcome?.status, "unknown");
});
for (const name of ["update_cart_item", "remove_cart_item"] as const) {
  test(`${name} explicit buyer option/slot tags cannot be substituted by model arguments`, async () => {
    for (const selector of [{ optionItemIds: ["small"], serviceSlotId: "chosen-slot" },
      { optionItemIds: ["large"], serviceSlotId: "other-slot" }, { serviceSlotId: "chosen-slot" }]) {
      let writes = 0;
      const policy = createCartTurnPolicy(`${name === "update_cart_item" ? "Altere a quantidade no carrinho" : "Remova o produto do carrinho"} [variantId:chosen] [optionItemIds:large] [serviceSlotId:chosen-slot]`, undefined, "actual-cart");
      const [tool] = policy.wrap([{ name, execute: async () => { writes++; return { ok: true as const, data: projectedCart() }; } }]);
      const result = await tool!.execute({ cartId: "actual-cart", variantId: "chosen", ...selector, ...(name === "update_cart_item" ? { quantity: 2 } : {}) });
      assert.equal(result.ok, false); assert.equal(writes, 0); assert.equal(policy.mutationOutcome?.status, "rejected");
    }
  });
}
test("unexpected post-write correlation failure is terminal unknown, never a thrown retry signal", async () => {
  let writes = 0;
  const policy = createCartTurnPolicy("Altere a quantidade no carrinho", undefined, "actual-cart");
  const data = Object.defineProperty(projectedCart(), "items", { get() { throw Error("PRIVATE_CORRELATION_ERROR"); } });
  const [tool] = policy.wrap([{ name: "update_cart_item", execute: async () => { writes++; return { ok: true as const, data }; } }]);
  const result = await tool!.execute({ cartId: "actual-cart", variantId: "chosen", quantity: 2 });
  assert.equal(result.ok, false); assert.equal(policy.mutationOutcome?.status, "unknown"); assert.equal(policy.terminal, true);
  assert.equal(writes, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CORRELATION_ERROR/);
});
