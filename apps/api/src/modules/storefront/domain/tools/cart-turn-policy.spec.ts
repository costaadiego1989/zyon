import test from "node:test";
import assert from "node:assert/strict";
import { createCartTurnPolicy } from "./cart-turn-policy.js";

test("the service slot tag binds model arguments and refused writes have an immediate result", async () => {
  let calls = 0;
  const policy = createCartTurnPolicy("Adicionar serviço ao carrinho [variantId:service] [serviceSlotId:morning]", undefined, "cart");
  const [tool] = policy.wrap([{ name: "add_item_to_cart", execute: async () => { calls++; return { ok: true, data: {} }; } }]);
  await tool.execute({ variantId: "service", quantity: 1, selectedServiceSlotId: "afternoon" });
  assert.equal(calls, 0);
  assert.deepEqual(policy.addOutcomes, [{ variantId: "service", serviceSlotId: "morning", status: "rejected", code: "cart_selection_binding_mismatch" }]);
});
test("service addition is confirmed only by the canonical matching slot in the returned cart", async () => {
  for (const returnedSlot of ["morning", "afternoon", undefined]) {
    const policy = createCartTurnPolicy("Adicionar serviço ao carrinho [variantId:service] [serviceSlotId:morning]", undefined, "cart");
    const [tool] = policy.wrap([{ name: "add_item_to_cart", execute: async () => ({ ok: true, data: { cartId: "cart", items: [{ variantId: "service", quantity: 1, selectedServiceSlot: { slotId: returnedSlot } }] } }) }]);
    await tool.execute({ variantId: "service", quantity: 1, selectedServiceSlotId: "morning" });
    assert.equal(policy.addOutcomes[0].status, returnedSlot === "morning" ? "succeeded" : "unknown");
  }
});

for (const [message, name] of [
  ["Adicionar Livro ao carrinho", "add_item_to_cart"], ["Quero comprar o Livro", "add_item_to_cart"],
  ["Pode adicionar Livro ao carrinho?", "add_item_to_cart"], ["Remover Livro do carrinho", "remove_cart_item"],
  ["Alterar quantidade no carrinho para 2 unidades", "update_cart_item"], ["Esvaziar carrinho", "clear_cart"],
  ["Aplicar cupom OFERTA10", "apply_coupon"], ["Remover cupom", "remove_coupon"], ["Finalizar compra", "create_checkout_session"],
] as const) {
  test(`preserves explicit cart command: ${message}`, async () => {
    let calls = 0;
    const [tool] = createCartTurnPolicy(message).wrap([{ name, execute: async () => {
      calls++; return { ok: true, data: { cartId: "conversation", items: [] } };
    } }]);
    assert.equal((await tool.execute({ variantId: "variant", quantity: 1 })).ok, true); assert.equal(calls, 1);
  });
}
