import test from "node:test";
import assert from "node:assert/strict";
import { allowsSalesDiscovery, countSalesDiscoveryRounds, isBarePriceObjection, isBroadShoppingRequest, isUnspecifiedShoppingRequest, parseSalesDiscoveryQuestion } from "./sales-discovery.js";

test("object-free shopping intents need discovery rather than a catalog dump", () => {
  for (const text of ["quero comprar um produto", "Quero comprar algo!", "Eu gostaria de comprar alguma coisa.",
    "Oi, quero comprar", "Preciso de um produto", "Me ajude a escolher um produto", "Encontrar Produto",
    "Queria uma indicação de produto", "Quero comprar um produto de vocês", "Quero comprar algo [variantId:previous_product]"]) {
    assert.equal(isUnspecifiedShoppingRequest(text), true, text);
  }
});

test("bare price objections need a target budget, but explicit cheaper-product or checkout requests retain their route", () => {
  for (const message of ["Está caro", "Tá muito caro!", "Achei caro", "Muito caras", "Caro."]) assert.equal(isBarePriceObjection(message), true, message);
  for (const message of ["Quero algo mais barato até R$ 80", "Quero mais opções", "O frete está caro", "Finalizar compra", "Está caro, até 80 reais"])
    assert.equal(isBarePriceObjection(message), false, message);
});

test("an area alone needs clarification; a profile is enough to search without a mandatory goal question", () => {
  for (const text of ["um produto para pele", "Quero algo para o cabelo"]) {
    assert.equal(isBroadShoppingRequest(text), true, text);
    assert.equal(allowsSalesDiscovery(text), true, text);
  }
  for (const text of ["Quero comprar um produto para minha pele oleosa", "Preciso de algo para pele seca", "Quero um hidratante para pele oleosa sem perfume", "Quero comprar este produto", "Ver produtos para pele", "Finalizar compra", "Quero algo até R$ 50"])
    assert.equal(isBroadShoppingRequest(text), false, text);
  for (const text of ["Quero comprar este produto", "Comprar Núcleo Sérum de Barreira", "Ver Produtos", "Quais produtos vocês têm à venda?",
    "Mostre opções", "Adicionar esse ao carrinho", "Finalizar compra", "Detalhes desse produto", "Produtos Semelhantes", "Falar com Humano"])
    assert.equal(allowsSalesDiscovery(text), false, text);
  assert.equal(allowsSalesDiscovery("Quero produto para pele", "untrusted attachment"), false);
});

test("selection and filtering navigation are not another preference-discovery turn", () => {
  for (const message of ["Selecionar Produto", " SELECIONAR   PRODUTO! ", "Filtrar Produtos"])
    assert.equal(allowsSalesDiscovery(message), false, message);
  assert.equal(allowsSalesDiscovery("Quero um produto para minha pele oleosa"), true);
  assert.equal(allowsSalesDiscovery("Oleosa"), true);
  assert.equal(isUnspecifiedShoppingRequest("Me ajude a escolher um produto"), true);
});

test("consecutive clarification history is bounded at three, ignoring the opening greeting", () => {
  const history:Array<{role:"user"|"assistant";content:string}>=[{role:"assistant",content:"Olá! Como posso ajudar?"}];
  assert.equal(countSalesDiscoveryRounds(history),0);
  for (let round=1; round<=4; round++) {
    history.push({role:"user",content:"resposta"},{role:"assistant",content:`Preferência ${round}?`});
    assert.equal(countSalesDiscoveryRounds(history), Math.min(round,3));
  }
  history.push({role:"assistant",content:"Aqui estão os detalhes confirmados."});
  assert.equal(countSalesDiscoveryRounds(history),0);
});

test("a catalog recommendation ending in a question closes the discovery interview", () => {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: "Quero um produto" }, { role: "assistant", content: "Qual necessidade?" },
    { role: "user", content: "Hidratação leve" }, { role: "assistant", content: "Para o rosto ou corpo?" },
    { role: "user", content: "Rosto, até R$ 150" },
  ];
  for (const reply of ["Encontrei três opções. A Bruma tem hidratação leve, por R$ 79,90. Quer ver os detalhes dela?",
    "Esta opção tem textura leve. Quer ver os detalhes?", "Encontrei estas opções. Qual você prefere?"]) {
    assert.equal(countSalesDiscoveryRounds([...history, { role: "assistant", content: reply }]), 0, reply);
    assert.equal(countSalesDiscoveryRounds([...history, { role: "assistant", content: reply },
      { role: "user", content: "Está caro" }, { role: "assistant", content: "Qual faixa de valor fica confortável?" }]), 1);
  }
});

test("discovery questions accept only bounded answer choices, never commerce buttons or control tags", () => {
  const parsed=parseSalesDiscoveryQuestion({question:"Como é sua pele?",replies:["Oleosa","oleosa","Seca","Ver Carrinho","Finalizar Compra","Continuar Comprando","Produtos Semelhantes","<script>","[variantId:unsafe]","Não sei","Mista","Normal"]});
  assert.deepEqual(parsed,{question:"Como é sua pele?",replies:["Oleosa","Seca","Não sei","Mista"]});
  assert.deepEqual(parseSalesDiscoveryQuestion({question:"Qual seu objetivo?",replies:[]}),{question:"Qual seu objetivo?",replies:[]});
  for(const question of ["", "Primeiro? E depois?", "Sem pergunta", "<script>Qual?</script>","Qual\\u00e9?"])
    assert.equal(parseSalesDiscoveryQuestion({question,replies:[]}),null,question);
});

test("navigation, specific needs, objections, refusals and selection references are not vague shopping", () => {
  for (const text of ["Ver Produtos", "Quero ver os produtos disponíveis", "Quais produtos vocês vendem?", "Mostre o catálogo",
    "Quero um produto para minha pele oleosa", "Quero um hidratante sem perfume", "Quero algo até R$ 50",
    "Comprar Núcleo Sérum de Barreira", "quero comprar este produto", "leva esse", "Não quero comprar agora",
    "Está caro", "Finalizar compra", "Adicionar produto ao carrinho [variantId:serum]", "Oi", "Produtos"]) {
    assert.equal(isUnspecifiedShoppingRequest(text), false, text);
  }
});
