import test from "node:test";
import assert from "node:assert/strict";
import { explicitCartQuantityTarget, hasFractionalCartQuantity } from "./cart-quantity-input.js";

test("a direct cart quantity command rejects a fractional target without rounding", () => {
  for (const text of [
    "Mude a quantidade do Kit Organizador Essencial no carrinho para 1,5 unidade.",
    "Altere a quantidade do Kit Organizador Essencial no carrinho para 1.5 unidades.",
    "Por favor, pode mudar a quantidade do Kit no carrinho para 2,25 itens?",
    "Atualize a quantidade no carrinho para -1,5 unidade.",
  ]) assert.equal(hasFractionalCartQuantity(text), true, text);
});

test("numeric target binding ignores product/model numbers and never derives authority from quoted text", () => {
  assert.equal(explicitCartQuantityTarget("Mude a quantidade do Kit Modelo 1,5 no carrinho para 20 unidades."), 20);
  assert.equal(explicitCartQuantityTarget("Altere a quantidade no carrinho para 0 unidades."), 0);
  for (const text of ['"Mude a quantidade no carrinho para 20 unidades."',
    "Exemplo: Mude a quantidade no carrinho para 20 unidades.", "Não mude a quantidade no carrinho para 20 unidades.",
    "Qual é a quantidade do Kit 20 no carrinho?", "Mude a quantidade no carrinho. O preço é R$ 20."])
    assert.equal(explicitCartQuantityTarget(text), undefined, text);
});

test("price/product decimals, queries, quoted commands and valid integral targets are not quantity errors", () => {
  for (const text of [
    "Mude a quantidade do Kit Modelo 1,5 no carrinho para 2 unidades.",
    "Mude a quantidade no carrinho para 1,0 unidade.",
    "Mude a quantidade no carrinho para 0 unidades.",
    "Mude a quantidade no carrinho para 20 unidades.",
    "Mude a quantidade no carrinho para -1 unidade.",
    "Encontre produtos de 1,5 reais.",
    "Qual é a quantidade do Kit de 1,5 L no carrinho?",
    "Exemplo: Mude a quantidade no carrinho para 1,5 unidade.",
    '"Mude a quantidade no carrinho para 1,5 unidade."',
    "Não mude a quantidade no carrinho para 1,5 unidade.",
    "Mude a quantidade no carrinho para 2 unidades. O preço é R$ 1,5.",
  ]) assert.equal(hasFractionalCartQuantity(text), false, text);
});
