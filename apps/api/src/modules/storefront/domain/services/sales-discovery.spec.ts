import test from "node:test";
import assert from "node:assert/strict";
import { isUnspecifiedShoppingRequest } from "./sales-discovery.js";

test("object-free shopping intents need discovery rather than a catalog dump", () => {
  for (const text of ["quero comprar um produto", "Quero comprar algo!", "Eu gostaria de comprar alguma coisa.",
    "Oi, quero comprar", "Preciso de um produto", "Me ajude a escolher um produto", "Encontrar Produto",
    "Queria uma indicação de produto", "Quero comprar um produto de vocês", "Quero comprar algo [variantId:previous_product]"]) {
    assert.equal(isUnspecifiedShoppingRequest(text), true, text);
  }
});

test("navigation, specific needs, objections, refusals and selection references are not vague shopping", () => {
  for (const text of ["Ver Produtos", "Quero ver os produtos disponíveis", "Quais produtos vocês vendem?", "Mostre o catálogo",
    "Quero um produto para minha pele oleosa", "Quero um hidratante sem perfume", "Quero algo até R$ 50",
    "Comprar Núcleo Sérum de Barreira", "quero comprar este produto", "leva esse", "Não quero comprar agora",
    "Está caro", "Finalizar compra", "Adicionar produto ao carrinho [variantId:serum]", "Oi", "Produtos"]) {
    assert.equal(isUnspecifiedShoppingRequest(text), false, text);
  }
});
