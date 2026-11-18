import assert from "node:assert/strict";
import test from "node:test";
import { BUYER_HUB_COMMANDS,buyerHubCommand,buyerHubRoute } from "./buyer-hub.js";
import { buildMetaUiView,presentMetaUi,withMetaCartNavigation } from "./meta-ui-renderer.js";
import { withMetaProductNavigation } from "./meta-product-navigation.js";

test("T57 fixed human action belongs to the main menu in both modes",async t=>{
  await t.test("keeps all nine former commands and adds exactly one fixed human choice",()=>{
    assert.equal(BUYER_HUB_COMMANDS.length,10);
    assert.deepEqual(BUYER_HUB_COMMANDS.slice(0,9).map(entry=>entry.command),["/comprarapida","/carrinho","/produtos","/categorias","/ofertas","/favoritos","/dados","/enderecos","/ajuda"]);
    for(const command of ["/comprarapida","/carrinho","/produtos","/categorias","/ofertas","/favoritos","/dados","/enderecos","/ajuda"])
      assert.equal(BUYER_HUB_COMMANDS.filter(entry=>entry.command===command).length,1);
    assert.equal(BUYER_HUB_COMMANDS.filter(entry=>entry.command==="/atendente").length,1);
    assert.equal(buyerHubCommand("Falar com atendente"),"/atendente");
    assert.deepEqual(buyerHubRoute("/atendente"),{message:"Falar com atendente"});
  });
  await t.test("all ten root controls fit the native menu without displacing a checkout action",()=>{
    for(const stage of ["store","checkout"] as const){
      const state={version:1 as const,conversationId:"conversation",stage,history:[],revision:"old",page:0,previousViews:[],checkoutSessionId:"existing-checkout"};
      const view=buildMetaUiView({agentMessage:"🤖 *Menu principal*",blocks:[{type:"buyer_hub_actions",data:{scope:"main_menu",choices:[]}}],
        quickReplies:BUYER_HUB_COMMANDS.map(entry=>entry.label),state});
      const shown=presentMetaUi(view,"original-inbox",0,{canGoBack:true});
      assert.equal(shown.totalPages,1);assert.equal(shown.numericSelections.length,10);
      assert.equal(view.choices.filter(choice=>choice.label==="Falar com atendente").length,1);
      for(const message of shown.messages)if(message.type==="interactive"&&message.interactive.type==="list")
        assert.ok(message.interactive.action.sections.flatMap(section=>section.rows).length<=10);
      assert.equal(state.checkoutSessionId,"existing-checkout");
    }
  });
  await t.test("product navigation keeps a single main-menu action instead of adding human controls to each product",()=>{
    const state={version:1 as const,conversationId:"conversation",stage:"store" as const,history:[],revision:"r",page:0,previousViews:[]};
    const view=buildMetaUiView({agentMessage:"Product context",blocks:[{type:"product_card",data:{id:"product-a",name:"Produto",price:100}}],quickReplies:[],state});
    const navigated=withMetaProductNavigation(view,undefined,state);
    assert.equal(navigated.choices.filter(choice=>choice.label==="Falar com atendente").length,0);
    const shown=presentMetaUi(navigated,"product-context");
    assert.equal(shown.numericSelections.filter(action=>action.kind==="message"&&action.message==="/atalhos").length,1);
  });
});

test("T57 product details keep their admitted purchase and main menu without global human shortcuts",()=>{
  const state={version:1 as const,conversationId:"conversation",stage:"store" as const,history:[],revision:"r",page:0,previousViews:[]};
  const view=buildMetaUiView({agentMessage:"Product context",blocks:[{type:"product_card",data:{id:"product-a",name:"Produto",price:100}}],
    quickReplies:["Falar com atendente","/atendente","👤 Falar com atendente"],state});
  const purchase={kind:"tool" as const,tool:"add_item_to_cart",args:{productId:"product-a",variantId:"admitted-variant",quantity:1}};
  view.choices.push({label:"Adicionar ao carrinho",action:purchase});
  const product=withMetaCartNavigation(withMetaProductNavigation(view,undefined,state),true);
  assert.equal(product.choices.filter(choice=>choice.action.kind==="message"&&["Falar com atendente","/atendente","👤 Falar com atendente"].includes(choice.action.message)).length,0);
  const shown=presentMetaUi(product,"product-human-isolation");
  assert.deepEqual(shown.numericSelections.filter(action=>action.kind==="tool"&&action.tool==="add_item_to_cart"),[purchase]);
  assert.equal(shown.numericSelections.filter(action=>action.kind==="message"&&action.message==="/atalhos").length,1);
});
