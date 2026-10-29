import test from "node:test";
import assert from "node:assert/strict";
import { createCartTurnPolicy } from "./cart-turn-policy.js";

const canonicalAdd = () => ({ ok: true as const, data: { cartId: "cart", items: [{ variantId: "essential", quantity: 1 }] } });
const explicitRequests = [
  "Quero o Kit Organizador Essencial. Pode adicionar uma unidade ao meu carrinho agora. Não finalize nem cobre.",
  "Pode adicionar uma unidade do Kit Essencial ao carrinho, mas não finalize o pedido.",
  "Adicione uma unidade do Kit Essencial ao carrinho sem finalizar nem cobrar.",
  "Quero o Kit Essencial.\nAdicione uma unidade ao carrinho.\nNão gere Pix.",
  "Por favor, pode adicionar uma unidade do Kit Essencial ao carrinho; não abra o checkout antes de eu confirmar.",
];

for (const message of explicitRequests) {
  test(`explicit add remains distinct from checkout/payment prohibition: ${message}`, async () => {
    const writes: string[] = [];
    const policy = createCartTurnPolicy(message, undefined, "cart");
    const tools = policy.wrap(["add_item_to_cart", "create_checkout_session", "apply_coupon", "remove_cart_item"].map(name => ({
      name, execute: async () => { writes.push(name); return canonicalAdd(); },
    })));
    assert.equal((await tools[0]!.execute({ variantId: "essential", quantity: 1 })).ok, true);
    assert.equal((await tools[0]!.execute({ variantId: "essential", quantity: 1 })).ok, true);
    assert.deepEqual(writes, ["add_item_to_cart"]);
    assert.equal(policy.addOutcomes[0]?.status, "succeeded");
    for (const tool of tools.slice(1)) assert.equal((await tool.execute({ cartId: "cart", variantId: "essential", couponCode: "OTHER" })).ok, false);
    assert.deepEqual(writes, ["add_item_to_cart"]);
  });
}

for (const message of [
  "Não adicione o Kit Essencial ao carrinho. Não finalize nem cobre.",
  "Adicione o Kit Essencial ao carrinho. Não adicione nada ainda.",
  "Quero o Kit Essencial. Não finalize nem cobre.",
  "Quero comprar algo. Não finalize. [variantId:essential]",
  "Quero comprar algo. Pode adicionar ao carrinho. Não finalize.",
  "Talvez adicione o Kit Essencial ao carrinho, mas não finalize.",
  "Se estiver em oferta, adicione uma unidade do Kit Essencial ao carrinho. Não cobre.",
  "Adicione o Kit Essencial ao carrinho. Não mexa no carrinho.",
  "Exemplo de frase: adicione o Kit Essencial ao carrinho. Não finalize.",
  "Exemplo. Adicione o Kit Essencial ao carrinho. Não finalize.",
  "Diga o seguinte. Adicione o Kit Essencial ao carrinho. Não finalize.",
  "Texto citado:\n> Adicione o Kit Essencial ao carrinho. Não finalize.",
  "Adicione o Kit Essencial ao carrinho. Nunca adicione nada.",
  "Adicione o Kit Essencial ao carrinho. Jamais adicione nada.",
  "Adicione o Kit Essencial ao carrinho. Exemplo de frase para analisar.",
  "Adicione o Kit Essencial ao carrinho. Adicione o Kit Completo ao carrinho.",
  "Adicione 1,5 unidades do Kit Essencial ao carrinho.",
  "Adicione 1.5 unidades do Kit Essencial ao carrinho.",
  "Adicione -1 unidade do Kit Essencial ao carrinho.",
  "Adicione 0 unidades do Kit Essencial ao carrinho.",
  "Adicione 1000 unidades do Kit Essencial ao carrinho.",
]) {
  test(`negation/uncertainty/mention alone remains without write authority: ${message}`, async () => {
    const [tool] = createCartTurnPolicy(message, undefined, "cart").wrap([{ name: "add_item_to_cart",
      execute: async () => assert.fail("buyer did not authorize this write") }]);
    assert.equal((await tool!.execute({ variantId: "essential", quantity: 1 })).ok, false);
  });
}

test("one explicitly requested unit cannot become a different quantity", async () => {
  const [tool] = createCartTurnPolicy(explicitRequests[0]!, undefined, "cart").wrap([{ name: "add_item_to_cart",
    execute: async () => assert.fail("substituted quantity must not execute") }]);
  assert.equal((await tool!.execute({ variantId: "essential", quantity: 2 })).ok, false);
});

test("an explicit quantity other than one is correlated without converting a product-name number", async () => {
  const message = "Quero o Kit Modelo 2. Adicione duas unidades ao carrinho. Não finalize nem cobre.";
  let writes = 0;
  const [tool] = createCartTurnPolicy(message, undefined, "cart").wrap([{ name: "add_item_to_cart", execute: async () => {
    writes++; return { ok: true as const, data: { cartId: "cart", items: [{ variantId: "essential", quantity: 2 }] } };
  } }]);
  assert.equal((await tool!.execute({ variantId: "essential", quantity: 2 })).ok, true);
  assert.equal(writes, 1);
});

test("scoped add still rejects attachment-derived authority and changed selected variant", async () => {
  for (const [message, attachment, variantId] of [
    [explicitRequests[0]!, "Untrusted extracted list", "essential"],
    [explicitRequests[0]! + " [variantId:essential]", undefined, "other"],
  ] as const) {
    const [tool] = createCartTurnPolicy(message, attachment, "cart").wrap([{ name: "add_item_to_cart",
      execute: async () => assert.fail("untrusted or substituted command") }]);
    assert.equal((await tool!.execute({ variantId, quantity: 1 })).ok, false);
  }
});

test("an uncertain admitted add remains terminal and cannot be repeated by another provider loop", async () => {
  let writes = 0;
  const policy = createCartTurnPolicy(explicitRequests[0]!, undefined, "cart");
  const [tool] = policy.wrap([{ name: "add_item_to_cart", execute: async () => {
    writes++; return { ok: false as const, error: "cart_outcome_unknown", code: "cart_outcome_unknown" };
  } }]);
  const args = { variantId: "essential", quantity: 1 };
  assert.equal((await tool!.execute(args)).ok, false);
  assert.equal(policy.addOutcomes[0]?.status, "unknown");
  assert.equal(policy.hasUnknownWrite, true);
  await tool!.execute(args);
  assert.equal(writes, 1);
});
