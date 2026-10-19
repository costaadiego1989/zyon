import test from "node:test";
import assert from "node:assert/strict";
import { detectStoreStage, storefrontQuickReplies } from "./storefront-quick-replies.service.js";

const cart = { items: [{ variantId: "previous", name: "Produto anterior", quantity: 1 }], total: 100, itemCount: 1 };

test("wanting to buy does not imply an item was added, even with an existing cart", () => {
  for (const userMessage of ["quero comprar um produto", "um produto para pele", "Quero comprar algo"]){
    assert.equal(detectStoreStage(null,{userMessage,cartItemCount:1}),"discovery");
    assert.deepEqual(storefrontQuickReplies(null,null,cart,undefined,userMessage),[]);
  }
  assert.notEqual(detectStoreStage(null,{userMessage:"Quero comprar Núcleo Sérum"}),"added_to_cart");
});

test("structured answer choices replace stage and merchant defaults, not the current question", () => {
  const question={question:"Como é sua pele?",replies:["Oleosa","Seca","Mista","Não sei"]};
  const configured:any={ stages:[{stage:"welcome",replies:["Ofertas"]}],fallback:["Finalizar Compra"] };
  assert.deepEqual(storefrontQuickReplies("ask_product_preferences",configured,cart,undefined,"quero comprar um produto",undefined,
    {discoveryQuestion:question,assistantMessage:question.question,hasBlocks:false}),question.replies);
  assert.deepEqual(storefrontQuickReplies(null,configured,cart,undefined,"Oleosa",undefined,
    {assistantMessage:"Qual seu objetivo com o cuidado?",hasBlocks:false}),[]);
});

test("real cart, catalog, shipping and coupon actions retain their existing suggestions", () => {
  assert.ok(storefrontQuickReplies("add_item_to_cart",null,cart).includes("Finalizar Compra"));
  assert.ok(storefrontQuickReplies("search_products",null,cart).includes("Selecionar Produto"));
  assert.deepEqual(storefrontQuickReplies("quote_shipping",null,cart,[{carrier:"QA",name:"Econômico",price:1490,days:5}]),["Econômico (5 dias) - R$ 14,90"]);
  assert.deepEqual(storefrontQuickReplies("list_promotions",null,cart,undefined,undefined,["QA10"]),["Aplicar cupom QA10","Ver Carrinho","Finalizar Compra"]);
});
