import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { useCheckoutStore } from "../src/store/checkout-store.js";
import { externalPaymentMethod, paymentRequiresCpf } from "../src/lib/payment-contact.js";

const initial = useCheckoutStore.getInitialState(), originalFetch = globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;useCheckoutStore.getState().stopPolling();useCheckoutStore.setState(initial,true);});

async function start(provider="stripe", method: "card"|"crypto"="card", crypto=false) {
  const calls: Array<{path:string;body:any}>=[];
  globalThis.fetch=async(resource,init)=>{
    const path=new URL(String(resource)).pathname,body=init?.body?JSON.parse(String(init.body)):undefined;
    calls.push({path,body});
    if(path.endsWith("/embed/start"))return Response.json({session_id:"native-session",experience:{stage:"payment",
      brand:{name:"Loja"},customer:{fullName:"Pessoa Teste",email:"test@example.com",phone:"11999999999",address:{zip:"01001000",street:"Rua",number:"1",complement:"",city:"São Paulo",state:"SP"}},
      items:[{sku:"sku",name:"Produto",quantity:1,unit_price:10}],shipping:{carrierKey:"carrier",method:"Entrega",customerPrice:0},
      totals:{subtotal:10,discount:0,service_fee:0,total:10,total_to_pay:10},
      paymentMethods:{pix:true,card:true,boleto:false,providers:{pix:provider,card:provider}},cryptoPaymentsEnabled:crypto}});
    if(path.endsWith("/embed/payment/intents"))return Response.json({id:"card-intent",method:"card",status:"requires_action",amountCents:1000,
      buyerFacing:{clientSecret:"fixture_secret",stripePublishableKey:"pk_test_fixture"}});
    if(path.endsWith("/embed/track"))return Response.json({});
    if(path.includes("/checkout-settings/"))return new Response("",{status:404});
    throw Error(`unexpected_request:${path}`);
  };
  await useCheckoutStore.getState().init({embedToken:"fixture-token",merchantId:"merchant",apiBaseUrl:"https://fixture.invalid",initialChannel:"chat",initialPaymentMethod:method});
  return calls;
}

test("WhatsApp card handoff uses existing contact/address without a new lead form or CPF prerequisite",async()=>{
  const calls=await start();const state=useCheckoutStore.getState();
  assert.equal(state.buyer.cpf,undefined);assert.equal(state.leadRegistered,true);assert.equal(state.pendingPayment,null);
  assert.equal(calls.filter(c=>c.path.endsWith("/embed/payment/intents")).length,1);
  assert.equal(state.messages.some(m=>m.blocks?.some(b=>b.type==="lead_capture")),false);
  assert.ok(state.messages.some(m=>m.blocks?.some(b=>b.type==="stripe_card")));
});

test("Asaas retains its provider-specific document gate before creating an intent",async()=>{
  const calls=await start("asaas");const state=useCheckoutStore.getState();
  assert.equal(calls.filter(c=>c.path.endsWith("/embed/payment/intents")).length,0);
  assert.equal(state.pendingPayment?.method,"credito");assert.ok(state.messages.some(m=>m.blocks?.some(b=>b.type==="lead_capture")));
});

test("a permitted crypto handoff proceeds to wallet network choice without collecting registration again",async()=>{
  const calls=await start("stripe","crypto",true);const state=useCheckoutStore.getState();
  assert.equal(calls.filter(c=>c.path.endsWith("/embed/payment/intents")).length,0);
  assert.ok(state.messages.some(m=>m.blocks?.some(b=>b.type==="crypto_chain_select")));
  assert.equal(state.messages.some(m=>m.blocks?.some(b=>b.type==="lead_capture")),false);
});

test("only card and crypto use the external handoff; document policy follows the selected provider",()=>{
  assert.equal(externalPaymentMethod("pix","chat"),undefined);assert.equal(externalPaymentMethod("card","voice"),undefined);
  assert.equal(externalPaymentMethod("card","chat"),"card");assert.equal(externalPaymentMethod("crypto","chat"),"crypto");
  assert.equal(paymentRequiresCpf("credito",{card:"stripe"}),false);assert.equal(paymentRequiresCpf("pix",{pix:"mercadopago"}),false);
  assert.equal(paymentRequiresCpf("credito",{card:"asaas"}),true);assert.equal(paymentRequiresCpf("pix",{pix:"asaas"}),true);
});
