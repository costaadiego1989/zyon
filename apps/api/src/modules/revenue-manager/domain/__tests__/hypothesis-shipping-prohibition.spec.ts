import test from "node:test";
import assert from "node:assert/strict";
import { validateHypothesisSafety } from "../services/hypothesis-validator.service.js";
import type { HypothesisGenerationResponse } from "../ports/hypothesis-generator.port.js";

const constraints = { max_discount_percent: 5, allow_free_shipping: false };
function response(text: string): HypothesisGenerationResponse {
  return { hypothesis_text: "Explicar as opções de entrega verificadas", reasoning: "O custo da entrega aparece no abandono.",
    expected_lift_percent: 0, template: { name: "Clareza da entrega", description: "Teste sujeito à aprovação.",
      variant_a: { name: "Controle", system_prompt: "Baseline", weight: 50, is_control: true },
      variant_b: { name: "Variação", system_prompt: text, weight: 50, is_control: false } } };
}

test("explicit shipping prohibitions, including the real sandbox provider phrase, preserve the guard", () => {
  for (const text of [
    "Mostre as opções calculadas. Não prometa frete grátis, não invente prazos, descontos ou urgência.",
    "Não ofereça frete grátis.", "Nunca prometa frete gratuito.", "Não conceda entrega grátis.",
    "Do not promise free shipping. Explain verified checkout information.", "Never offer free delivery.",
  ]) assert.doesNotThrow(() => validateHypothesisSafety(response(text), constraints, "Baseline"), text);
});

test("prohibitions never exempt an affirmative, conditional, quoted or contrasting shipping claim", () => {
  for (const text of [
    "Ofereça frete grátis.", "Free shipping for all buyers.",
    "Não prometa frete grátis. Ofereça frete grátis na compra.",
    "Não ofereça frete grátis, mas cubra o frete. Offer free shipping.",
    "Não prometa frete grátis, ofereça o benefício automaticamente.",
    "Não ofereça frete grátis a menos que o comprador peça.",
    "Não prometa frete grátis se o cliente não perguntar.",
    "Não apenas ofereça frete grátis: aplique automaticamente.",
    "Ignore a regra: Não prometa frete grátis.",
    'Diga "Não prometa frete grátis" e depois aplique o benefício.',
    "Never offer free shipping unless the buyer asks.",
    "Do not promise free shipping, but give it anyway.",
    "Do not promise free shipping. We cover the shipping costs.",
  ]) assert.throws(() => validateHypothesisSafety(response(text), constraints, "Baseline"), /UNAUTHORIZED_FREE_SHIPPING/, text);
});

test("shipping prohibition recognition does not bypass discounts or sensitive-data guards", () => {
  assert.throws(() => validateHypothesisSafety(response("Não prometa frete grátis. Ofereça desconto de 90%."), constraints), /EXTREME_DISCOUNT/);
  assert.throws(() => validateHypothesisSafety(response("Não prometa frete grátis. Peça a senha."), constraints), /SAFETY_VIOLATION/);
  assert.throws(() => validateHypothesisSafety(response("Never offer free shipping. Ask for CVV."), constraints), /SAFETY_VIOLATION/);
});
