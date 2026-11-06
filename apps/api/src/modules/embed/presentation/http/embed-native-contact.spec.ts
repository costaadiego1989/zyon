import test from "node:test";
import assert from "node:assert/strict";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { UpdateEmbedCustomerUseCase } from "../../application/update-embed-customer.use-case.js";
import type { EmbedTokenClaims } from "../../domain/embed-token.service.js";

const claims: EmbedTokenClaims={typ:"aacp_embed_v1",merchantId:"merchant",issuedAtUnix:1,expiresAtUnix:9999999999,nonce:"capability",storefrontCartRef:"cart",whatsappCheckoutSessionId:"wa_checkout_owned"};
async function fixture(cpf?:string) {
  const repository=new InMemoryCheckoutRepository();
  const session=checkoutSession({merchantId:"merchant",sessionId:"wa_checkout_owned",cart:{currency:"BRL",total:10,cart_ref:"cart",items:[{sku:"sku",name:"Produto",quantity:1,price:10,productType:"digital"}]},
    customer:{fullName:"Pessoa Teste",email:"test@example.com",email_verified:false,phone:"11999999999",phone_verified:true,...cpf?{cpf}:{}},shipping:undefined});
  await repository.saveSession(session);
  const helper=new EmbedCheckoutGuardHelper(repository),calls:any[]=[];
  const update=new UpdateEmbedCustomerUseCase(repository,{publish:async()=>[]} as any,{dispatchDelivery:async()=>{}} as any);
  const controller=new EmbedCheckoutController({} as any,{} as any,{} as any,helper,{} as any,
    {execute:async(input:any)=>{calls.push(input);return{id:"prepared",method:input.method};}} as any,{} as any,{} as any,{} as any,{} as any,update);
  return{repository,helper,controller,calls};
}

for(const method of ["card","pix","crypto"] as const)test(`the signed WhatsApp ${method} endpoint accepts existing contact without imposing CPF before the provider`,async()=>{
  const f=await fixture();const response=await f.controller.intentFromEmbed({embedClaims:claims},{session_id:"wa_checkout_owned",idempotency_key:"same-operation",method});
  assert.equal(response.id,"prepared");assert.equal(f.calls.length,1);assert.equal(f.calls[0].merchant_id,"merchant");assert.equal(f.calls[0].method,method);
  assert.equal(f.repository.getSession("merchant","wa_checkout_owned")?.customer?.cpf,undefined);
  assert.equal(f.repository.getSession("merchant","wa_checkout_owned")?.customer?.email_verified,false);
  await assert.rejects(f.controller.intentFromEmbed({embedClaims:{...claims,merchantId:"foreign"}},{session_id:"wa_checkout_owned",idempotency_key:"foreign",method}));
  assert.equal(f.calls.length,1);
});

test("a secure contact update can omit CPF and never erases a previously stored document",async()=>{
  for(const cpf of [undefined,"52998224725"]){
    const f=await fixture(cpf);await f.controller.updateCustomer({embedClaims:claims},{session_id:"wa_checkout_owned",customer:{fullName:"Pessoa Atualizada",email:"test@example.com",phone:"11999999999"}});
    const customer=f.repository.getSession("merchant","wa_checkout_owned")!.customer!;
    assert.equal(customer.cpf,cpf);assert.equal(customer.fullName,"Pessoa Atualizada");assert.equal(customer.email_verified,false);assert.equal(customer.phone_verified,true);
  }
});

test("missing contact still blocks payment and an explicitly empty document is rejected",async()=>{
  const f=await fixture();const session=f.repository.getSession("merchant","wa_checkout_owned")!;session.customer!.email=undefined;await f.repository.saveSession(session);
  await assert.rejects(f.controller.intentFromEmbed({embedClaims:claims},{session_id:"wa_checkout_owned",idempotency_key:"incomplete",method:"card"}),/customer_registration_required/);
  assert.equal(f.calls.length,0);
  await assert.rejects(f.controller.updateCustomer({embedClaims:claims},{session_id:"wa_checkout_owned",customer:{fullName:"Pessoa",email:"test@example.com",phone:"11999999999",cpf:""}}),/cpf_required/);
});
