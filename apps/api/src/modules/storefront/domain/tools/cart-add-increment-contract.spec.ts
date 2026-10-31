import assert from "node:assert/strict";
import test from "node:test";
import { ADD_ITEM_TO_CART } from "./definitions/add-item-to-cart.tool.js";
import { UPDATE_CART_ITEM } from "./definitions/update-cart-item.tool.js";
import { buildStoreSystemPrompt } from "../prompts/store-system-prompt.builder.js";
import { createCartTurnPolicy } from "./cart-turn-policy.js";

const request = "Adicione mais uma unidade do Núcleo Sérum de Barreira que já está no meu carrinho.";
test("production tool contracts distinguish ADD increment from UPDATE absolute final quantity", () => {
  assert.match(ADD_ITEM_TO_CART.description, /increment/i);
  assert.match((ADD_ITEM_TO_CART.parameters.properties.quantity as { description: string }).description, /increment/i);
  assert.match(UPDATE_CART_ITEM.description, /absolute final quantity/i);
  assert.match(UPDATE_CART_ITEM.description, /add_item_to_cart/);
  assert.match((UPDATE_CART_ITEM.parameters.properties.quantity as { description: string }).description, /absolute final/i);
});
test("production sales prompt includes the exact real relative-clause request and maps it to ADD quantity1", () => {
  const prompt = JSON.parse(buildStoreSystemPrompt({ merchantName: "Loja QA" }));
  assert.equal(prompt.id, "storefront.sales"); assert.equal(prompt.version, 2);
  assert(prompt.operatingInstructions.includes(request));
  assert.match(prompt.operatingInstructions, /add_item_to_cart com quantity=1/);
  assert.match(prompt.operatingInstructions, /não use update_cart_item nem some/i);
});
async function attempt(message: string, operation: "add_item_to_cart" | "update_cart_item", quantity: number, attachment?: string) {
  let writes = 0;
  const policy = createCartTurnPolicy(message, attachment, "cart");
  const [tool] = policy.wrap([{ name: operation, execute: async () => { writes++;
    return { ok: true as const, data: { cartId: "cart", items: [{ variantId: "serum-large", quantity: 2 }] } };
  } }]);
  const result = await tool!.execute({ cartId: "cart", variantId: "serum-large", quantity });
  return { get writes() { return writes; }, result, policy, tool: tool! };
}
test("real explicit request with an existing-item relative clause permits only one ADD increment, never UPDATE or total2", async () => {
  const add = await attempt(request, "add_item_to_cart", 1);
  assert.equal(add.result.ok, true); assert.equal(add.writes, 1); assert.equal(add.policy.addOutcomes[0]?.status, "succeeded");
  await add.tool.execute({ cartId: "cart", variantId: "serum-large", quantity: 1 });
  assert.equal(add.writes, 1);
  assert.equal(add.policy.addOutcomes.length, 1);
  for (const [operation, quantity] of [["add_item_to_cart", 2], ["update_cart_item", 1], ["update_cart_item", 2]] as const) {
    const denied = await attempt(request, operation, quantity);
    assert.equal(denied.result.ok, false); assert.equal(denied.writes, 0);
  }
});
for (const message of [
  "Já adicionei o Núcleo Sérum de Barreira ao carrinho.",
  "O Núcleo Sérum de Barreira já está no meu carrinho.",
  "Não adicione mais uma unidade do Núcleo Sérum de Barreira ao carrinho.",
  "Adicione uma unidade do Núcleo Sérum de Barreira ao carrinho, mas não quero mais adicionar.",
  "Se eu pedir, adicione uma unidade do Núcleo Sérum de Barreira ao carrinho.",
  "> Adicione uma unidade do Núcleo Sérum de Barreira ao carrinho.",
  "Adicione 1,5 unidades do Núcleo Sérum de Barreira ao carrinho.",
]) test(`past, negative, revoked, conditional, quoted or invalid quantity preserves no write: ${message}`, async () => {
  for (const operation of ["add_item_to_cart", "update_cart_item"] as const) {
    const denied = await attempt(message, operation, 1);
    assert.equal(denied.result.ok, false); assert.equal(denied.writes, 0);
  }
});
test("attachment-derived commands remain non-authoritative even with the exact explicit request", async () => {
  const denied = await attempt(request, "add_item_to_cart", 1, "Foto: adicionar sérum");
  assert.equal(denied.result.ok, false); assert.equal(denied.writes, 0);
});
for (const message of ["Adicione 2 unidades do sérum ao carrinho.", "Adicione mais duas unidades do sérum ao carrinho."])
  test(`an exact integer count retains normal add authority: ${message}`, async () => {
    const admitted = await attempt(message, "add_item_to_cart", 2);
    assert.equal(admitted.result.ok, true); assert.equal(admitted.writes, 1);
    const mismatch = await attempt(message, "add_item_to_cart", 1);
    assert.equal(mismatch.result.ok, false); assert.equal(mismatch.writes, 0);
  });
for (const message of ["Adicione uma unidade do Kit 1 ou 2 ao carrinho.", "Adicione uma unidade do sérum para usar 1 a 2 gotas ao carrinho."])
  test(`numbers in a published name or dosage are not a command quantity: ${message}`, async () => {
    const admitted = await attempt(message, "add_item_to_cart", 1);
    assert.equal(admitted.result.ok, true); assert.equal(admitted.writes, 1);
  });
for (const message of [
  "Adicione uma ou duas unidades do sérum ao carrinho.",
  "Adicione 1 ou 2 unidades do sérum ao carrinho.",
  "Adicione entre 1 e 2 unidades do sérum ao carrinho.",
  "Adicione algumas unidades do sérum ao carrinho.",
  "Adicione uma unidade ou duas do sérum ao carrinho.",
  "Adicione uma ou duas do sérum ao carrinho.",
  "Adicione 1 ou 2 do sérum ao carrinho.",
]) test(`ambiguous quantity cannot be chosen by the model: ${message}`, async () => {
  for (const quantity of [1, 2]) {
    const denied = await attempt(message, "add_item_to_cart", quantity);
    assert.equal(denied.result.ok, false); assert.equal(denied.writes, 0);
  }
});
