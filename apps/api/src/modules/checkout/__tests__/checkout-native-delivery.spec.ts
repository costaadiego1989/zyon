import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../application/services/checkout-offer.service.js";
import { createSendChatUseCase } from "../application/use-cases/send-chat-message.fixture.js";
import { DeterministicConversationAdapter } from "../infrastructure/adapters/deterministic-conversation.adapter.js";
import { checkoutShippingLabel } from "../domain/services/checkout-shipping-label.js";
import { localCheckoutScope } from "./local-checkout-scope.fixture.js";

test("completing number/complement immediately publishes all real quote results without CPF or another prompt", async () => {
  const repository = new InMemoryCheckoutRepository();
  await repository.saveSession(checkoutSession({shipping:undefined, customer:{ fullName:"Pessoa Teste",email:"test@example.com",phone:"11999999999",phone_verified:true,
    address_verified:true,address:{zip:"01001000",street:"Rua",city:"São Paulo",state:"SP"} }}));
  let quoteCalls = 0;
  const customer = new CheckoutCustomerService(repository);
  const shipping = new CheckoutShippingService(repository, customer, {execute:async()=>{quoteCalls++; return {
    id:"real-server-quote",expires_at:new Date(Date.now()+600000).toISOString(),quote_key:"cart-key",destination_zip:"01001000",
    results:[{carrier_key:"melhor-envio-1",label:"Correios PAC",price:1250,eta_days:6,is_free:false},
      {carrier_key:"melhor-envio-2",label:"Correios Sedex",price:2000,eta_days:2,is_free:false}]
  };}} as any, undefined, undefined, localCheckoutScope(repository));
  const send = createSendChatUseCase(repository,{customerService:customer,shippingService:shipping,offerService:new CheckoutOfferService(repository),conversation:new DeterministicConversationAdapter()});
  const input = {merchant_id:"mrc_1",session_id:"chk_1",conversation_id:"conv_1"};
  const first = await send.execute({...input,user_message:"96/204"});
  assert.equal(first.stage,"shipping"); assert.deepEqual(first.missing_fields,["frete"]); assert.equal(quoteCalls,1);
  assert.equal(first.experience?.shippingOptions?.length,2);
  const block=first.blocks?.find(b=>b.type==="shipping_options")!;
  assert.ok(block); assert.deepEqual((block.data as any).options.map((o:any)=>[o.key,o.cost]),[["melhor-envio-1",1250],["melhor-envio-2",2000]]);
  assert.doesNotMatch(first.message,/Vou carregar|CPF|Como posso ajudar com o seu pedido/);
  const saved=await repository.getSession("mrc_1","chk_1");
  assert.equal(saved!.customer?.address?.number,"96");assert.equal(saved!.customer?.address?.complement,"204");assert.equal(saved!.customer?.cpf,undefined);
  const faq=await send.execute({...input,user_message:"Tem frete grátis?"});
  assert.equal(faq.stage,"shipping");assert.equal(faq.experience?.shippingOptions?.length,2); assert.ok(faq.blocks?.some(b=>b.type==="shipping_options"));
  const selected=await send.execute({...input,user_message:checkoutShippingLabel(first.experience!.shippingOptions![1])});
  assert.equal(selected.stage,"payment");assert.equal(selected.experience?.shipping?.customerPrice,20);
  assert.equal(selected.blocks?.some(b=>b.type==="shipping_options")??false,false);assert.equal(quoteCalls,1);
});
