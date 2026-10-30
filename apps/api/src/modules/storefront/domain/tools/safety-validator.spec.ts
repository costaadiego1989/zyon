import test from "node:test";
import assert from "node:assert/strict";
import { isSafeGeneratedMessageV2 } from "@zyon/conversation-engine";
import { validateStorefrontMessage } from "./safety-validator.js";
import { createAllowedScopeAgent } from "../../infrastructure/agents/storefront-scope.fixture.js";

const deny = { allowStackDiscountAndFreeShipping: false };
const denials = [
  "A loja não permite acumular a oferta com frete grátis.",
  "Não é possível combinar frete grátis com essa oferta.",
  "A oferta e o frete grátis não podem ser usados juntos.",
  "O frete grátis não pode ser combinado com essa oferta.",
  "Essa oferta não pode ser combinada com frete grátis.",
  "A oferta do Kit Organizador Completo e o frete grátis não podem ser usados juntos.",
  "A regra atual da loja não permite combinar esses benefícios, então a oferta do Kit Organizador Completo e o frete grátis não podem ser usados juntos.",
  "Não, não é possível acumular. A regra atual da loja não permite combinar esses benefícios, então a oferta do Kit Organizador Completo e o frete grátis não podem ser usados juntos.\n\nNada foi aplicado ao seu carrinho.",
  "🤖 A oferta e o *frete grátis* não podem ser usados juntos.",
];

for (const message of denials) test(`canonical negative stacking policy supports an explicit denial: ${message}`, () => {
  const result = validateStorefrontMessage(message, deny);
  assert.equal(result.safe, true);
  assert.equal(result.message, message, "the buyer receives the original denial, without text replacement");
  assert.equal(isSafeGeneratedMessageV2(message), false, "generic safety rules are not relaxed");
});

for (const allowStackDiscountAndFreeShipping of [undefined, true]) {
  test(`a denial exception cannot infer policy authority from ${allowStackDiscountAndFreeShipping}`, () => {
    for (const message of denials) assert.equal(validateStorefrontMessage(message, { allowStackDiscountAndFreeShipping }).safe, false);
  });
}

const unsafe = [
  "Você não precisa pagar frete.",
  "Não há taxa de frete.",
  "Não precisa pagar o frete.",
  "Não pode acumular, mas já apliquei frete grátis.",
  "A oferta e o frete grátis não podem ser usados juntos, mas já apliquei frete grátis.",
  "A oferta e o frete grátis não podem ser usados juntos. Já apliquei frete grátis.",
  "A oferta e o frete grátis não podem ser usados juntos. Não há taxa de frete.",
  'A loja disse: "A oferta e o frete grátis não podem ser usados juntos."',
  "“A oferta e o frete grátis não podem ser usados juntos.”",
  "Se a oferta e o frete grátis não podem ser usados juntos, podemos conversar.",
  "Caso a loja não permita acumular a oferta com frete grátis, vou verificar.",
  "Não é verdade que a oferta e o frete grátis não podem ser usados juntos.",
  "A loja não impede acumular a oferta com frete grátis.",
  "Não é proibido acumular frete grátis com essa oferta.",
  "A oferta do Não é verdade que Produto e o frete grátis não podem ser usados juntos.",
  "A oferta e o frete grátis não podem ser usados juntos. Isso não é verdade.",
  "Hipoteticamente:\nA oferta e o frete grátis não podem ser usados juntos.",
  "Se a regra mudar:\nA oferta e o frete grátis não podem ser usados juntos.",
  "A loja disse:\n\"A oferta e o frete grátis não podem ser usados juntos.\"",
  "A oferta e o frete grátis não podem ser usados juntos?",
  "Liberei frete grátis.",
  "A loja não permite acumular a oferta com frete grátis. Você tem 99% de desconto.",
  "A loja não permite acumular a oferta com frete grátis. Seu pagamento foi confirmado.",
  "A loja não permite acumular a oferta com frete grátis. Sua senha é necessária.",
];
for (const message of unsafe) test(`negative stacking policy never authorizes a claim: ${message}`, () => {
  assert.equal(validateStorefrontMessage(message, deny).safe, false);
});

test("denial handling preserves the original length limit", () => {
  const message = "A oferta e o frete grátis não podem ser usados juntos.";
  assert.equal(validateStorefrontMessage(message, { ...deny, maxLength: message.length - 1 }).safe, false);
});

test("the agent carries the canonical stacking restriction through current reads without writing", async () => {
  const calls: string[] = [];
  const message = denials.find(value => value.startsWith("Não, não"))!;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    listPromotions: async () => { calls.push("promotions"); return { promotions: [], coupons: [] }; },
    getDailyDeals: async () => { calls.push("deals"); return { deals: [] }; },
    applyCoupon: async () => assert.fail("a policy question must not apply benefits"),
    addItemToCart: async () => assert.fail("a policy question must not add items"),
  } as never, provider: { chat: async () => ({ content: JSON.stringify({ schemaVersion: 1, message }),
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" }) } as never },
  { domain: "STORE_COMMERCE", intent: "NEGOTIATE_PRICE", requiresTool: true, needsProductDiscovery: false });
  const result = await agent.run({ merchantId: "merchant", sessionId: "conversation", cartId: "cart", history: [], storeCategory: "others",
    userMessage: "Posso acumular a oferta com frete grátis? Confira sem aplicar.", merchantPolicy: deny });
  assert.deepEqual(calls, ["promotions", "deals"]);
  assert.equal(result.safetyValidation.safe, true);
  assert.equal(result.message, message);
});
