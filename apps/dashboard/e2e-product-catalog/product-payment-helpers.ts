import {test as base,expect,type Page,type Locator} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createProductPaymentJourney} from '../../api/tests/product-payment-journey.fixture.mjs';
import {declineOptionalStorefrontConsent} from '../e2e/service-buyer-storefront-helpers.js';
import {declineWhatsAppMarketingOpening} from './product-catalog-read-helpers.js';
type Journey=Awaited<ReturnType<typeof createProductPaymentJourney>>;
const blockedDestinations=new WeakMap<Page,string[]>();
export const test=base.extend<{}, {paymentChannel:'storefront'|'whatsapp';paymentScenario:'pix'|'switch'|'duplex';journey:Journey}>({
  paymentChannel:['storefront',{option:true,scope:'worker'}],paymentScenario:['pix',{option:true,scope:'worker'}],
  journey:[async({paymentChannel,paymentScenario},use)=>{const own=await createProductPaymentJourney(paymentChannel,paymentScenario==='duplex'?'switch':paymentScenario);try{await use(own);}finally{await own.close();}},{scope:'worker'}],
});
const native=(page:Page,label:string|RegExp)=>page.getByRole('log',{name:'Mensagens capturadas',exact:true}).getByRole('button',{name:label,exact:typeof label==='string'}).last();
const embedResponse=(response:any)=>new URL(response.url()).pathname.endsWith('/embed/chat')&&response.request().method()==='POST';
async function setup(page:Page,journey:Journey){
  blockedDestinations.set(page,[]);
  await page.context().route('**/*',route=>{const url=route.request().url();if(new URL(url).origin===journey.origin)return route.continue();blockedDestinations.get(page)!.push(url);return route.abort('blockedbyclient');});
  await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const label=document.createElement('aside');label.textContent='Dados sintéticos · PSP/Pix não pagável e Meta/e-mail OTP capturados · Recibo: somente SQL/outbox/UI · Sem cobrança/envio externo';Object.assign(label.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'20000',padding:'5px',background:'#143d2b',color:'white',font:'11px system-ui',pointerEvents:'none'});document.body.append(label);}));
  if(journey.channel==='whatsapp')await page.goto(journey.origin);
}
async function sendNative(page:Page,message:string,button?:Locator){
  const firstTurn=await page.getByRole('log',{name:'Mensagens capturadas',exact:true}).locator('article').count()===0;
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/send'&&response.request().method()==='POST');
  if(button){expect(await button.getAttribute('data-control-id')).toMatch(/^zyon:[a-f0-9]{32}$/);await button.focus();await page.keyboard.press('Enter');}
  else{const input=page.getByRole('textbox',{name:'Mensagem',exact:true});await input.fill(message);await input.press('Enter');}
  const response=await pending;expect(response.status()).toBe(200);expect((await response.json()).status).toBe('processed');await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');
  if(firstTurn)await declineWhatsAppMarketingOpening(page);
}
async function send(page:Page,journey:Journey,message:string,button?:Locator){
  if(journey.channel==='whatsapp'){await sendNative(page,message,button);return;}
  const pending=page.waitForResponse(embedResponse);
  if(button){await button.focus();await page.keyboard.press('Enter');}
  else{const input=page.getByRole('textbox',{name:'Mensagem',exact:true}).last();await input.fill(message);await input.press('Enter');}
  const response=await pending;expect(response.status()).toBe(201);return await response.json();
}
async function add(page:Page,journey:Journey){
  if(journey.channel==='storefront'){
    await page.goto(journey.origin+'/store/'+journey.slug+'?show=content&product='+journey.productId);
    await declineOptionalStorefrontConsent(page);
    const detail=page.getByRole('dialog',{name:'Detalhes do produto',exact:true});await expect(detail).toContainText(journey.names.product);
    const response=page.waitForResponse(value=>new URL(value.url()).pathname.endsWith('/messages')&&value.request().method()==='POST');
    await detail.getByRole('button',{name:'Adicionar ao carrinho',exact:true}).first().click();const reply=await response;expect(reply.status()).toBe(201);
    expect((await reply.json()).blocks.some((block:any)=>block.type==='cart_add_result'&&block.data.status==='succeeded'&&block.data.variantId===journey.variantId)).toBe(true);
    await detail.getByRole('button',{name:'Fechar produto e voltar ao chat',exact:true}).click();
  }else{
    await sendNative(page,'/produtos');await sendNative(page,'',native(page,'Ver detalhes'));await sendNative(page,'',native(page,'🛒 Adicionar'));
  }
  await expect.poll(async()=>{const row=await journey.cart();return row?.items.map((item:any)=>[item.variantId,item.quantity,item.unitPriceCents]);}).toEqual([[journey.variantId,1,4000]]);
  const cart=await journey.cart();expect(cart.total).toBe(4000);expect(cart.discount).toBe(0);return cart;
}
async function loginAndOpenCheckout(page:Page,journey:Journey){
  if(journey.channel==='whatsapp'){await sendNative(page,'/carrinho');await sendNative(page,'',native(page,/^Finalizar (?:pedido|compra)$/i));return;}
  await page.getByRole('button',{name:/^Carrinho(?::|$)/}).last().click();await page.getByRole('dialog',{name:'Carrinho',exact:true}).getByRole('button',{name:'Finalizar pedido',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toHaveCount(1);await expect(dialog.getByText('Para finalizar sua compra, confirme sua identidade',{exact:true})).toBeVisible();await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:/Entrar com e-mail/}).click();await dialog.getByRole('textbox',{name:'E-mail',exact:true}).fill(journey.email);
  const sent=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/buyer/email/send')&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Confirmar',exact:true}).click();expect((await sent).status()).toBe(201);
  let code='';await expect.poll(()=>{try{return code=journey.emailCode();}catch{return'';}},{timeout:10000}).toMatch(/^\d{6}$/);
  await dialog.getByRole('textbox',{name:'Código de verificação',exact:true}).fill(code);
  const verified=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/buyer/email/login/verify')&&response.request().method()==='POST');
  const started=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/embed/start')&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Confirmar',exact:true}).click();const auth=await verified;expect(auth.status()).toBe(201);expect((await auth.json()).globalUserId).toBe(journey.buyerId);expect((await started).status()).toBe(201);await expect(dialog).toBeHidden();
  await expect(page.getByRole('log',{name:'Mensagens do chat',exact:true})).toBeVisible();
}

export {expect};
export async function capture(page:Page,label:string){
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');
  await mkdir(directory,{recursive:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:resolve(directory,`${label}-${page.viewportSize()?.width}.running.png`),fullPage:false});
}
export async function preparePayment(page:Page,journey:Journey){
  await setup(page,journey);const before=await journey.finance();
  expect(before.intents).toHaveLength(0);expect(before.orders).toHaveLength(0);expect(before.movements).toHaveLength(0);expect(before.sales).toHaveLength(0);
  expect(before.stock.map((row:any)=>[row.quantity,row.reserved])).toEqual([[20,0]]);
  expect(before.inventory.map((row:any)=>[row.sku,row.quantity,row.reserved])).toEqual([[journey.variantId,20,0]]);
  await add(page,journey);await loginAndOpenCheckout(page,journey);
  if(journey.channel==='storefront')await send(page,journey,'',page.getByRole('log',{name:'Mensagens do chat',exact:true}).getByRole('button',{name:'Vamos prosseguir',exact:true}));
  const checkout=await journey.checkout();expect(checkout.globalUserId).toBe(journey.buyerId);
  expect(checkout.customer.address).toEqual(journey.addresses.home);expect(checkout.customer.cpf).toBeTruthy();
  expect(checkout.customer.phone.replace(/\D/g,'')).toBe(journey.phone);
  const options=checkout.shippingOptions;expect(options).toHaveLength(1);expect(options[0].carrierKey).toBe('own_delivery_neighborhood_centro');
  expect(Math.round(options[0].customerPrice*100)).toBe(750);
  const choice=journey.channel==='whatsapp'?native(page,/Entrega própria.*Centro/):
    page.getByRole('log',{name:'Mensagens do chat',exact:true}).getByRole('button').filter({hasText:/Entrega própria.*Centro/}).last();
  await send(page,journey,'',choice);
  const selected=await journey.checkout();expect(selected.shipping.quoteId).toBe(options[0].quoteId);
  expect(Math.round(selected.shipping.customerPrice*100)).toBe(750);
  expect(selected.cart.items.map((row:any)=>[row.variantId,row.quantity,row.price])).toEqual([[journey.variantId,1,40]]);
  const evidence=journey.evidence();expect(evidence.api.authOverrides).toBe(false);expect(evidence.api.repositoryOverrides).toBe(false);
  expect(evidence.api.providerCalls).toBe(0);expect(evidence.api.localPaymentTransportOverrides).toEqual(['payment.PAYMENT_PROVIDER_PORT.fetch']);
  return before;
}
function currentMethod(page:Page,journey:Journey,method:'pix'|'card',switching:boolean){
  if(journey.channel==='whatsapp')return native(page,method==='pix'?/^Pix(?:\s|$)/:/^Cartão de crédito(?:\s|$)/);
  return switching?page.getByRole('button',{name:method==='pix'?/^Trocar para Pix/:/^Trocar para (?:Cartão|Crédito)/i}).last():
    page.getByRole('button',{name:method==='pix'?/^Pix(?:\s|$)/i:/^(?:Cartão de crédito|Crédito)(?:\s|$)/i}).last();
}
export async function choosePayment(page:Page,journey:Journey,method:'pix'|'card'){
  const before=await journey.finance(),existing=new Set(before.intents.map((row:any)=>row.id));
  const choice=currentMethod(page,journey,method,before.intents.length>0);
  if(journey.channel==='whatsapp')await sendNative(page,'',choice);
  else{
    const created=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/embed/payment/intents')&&response.request().method()==='POST');
    await choice.focus();await page.keyboard.press('Enter');expect((await created).status()).toBe(201);
  }
  await expect.poll(async()=>(await journey.finance()).intents.filter((row:any)=>!existing.has(row.id)&&row.method===method).length).toBe(1);
  const row=(await journey.finance()).intents.find((value:any)=>!existing.has(value.id)&&value.method===method);
  expect(row.currency).toBe('BRL');expect(row.providerPaymentId).toMatch(/^pay_captured_/);
  expect(row.creation.input.provider).toBe('asaas');expect(row.creation.input.intentId).toBe(row.id);
  const b=row.amountBreakdown;expect(b.itemsSubtotalCents).toBe(4000);expect(b.shippingCents).toBe(750);expect(b.discountCents).toBe(0);
  expect(Number.isSafeInteger(b.platformFeeCents)&&b.platformFeeCents>=0).toBe(true);
  expect(row.amountCents).toBe(4750+b.platformFeeCents);expect(row.creation.input.amountCents).toBe(row.amountCents);
  return row;
}
export async function assertPending(journey:Journey,before:any,intent:any){
  const current=await journey.finance();expect(current.intents.find((row:any)=>row.id===intent.id).status).toMatch(/^(pending|requires_action)$/);
  expect(current.orders).toHaveLength(0);expect(current.movements).toHaveLength(0);expect(current.sales).toHaveLength(0);
  expect(current.stock).toEqual(before.stock);expect(current.inventory).toEqual(before.inventory);
  expect(current.events.filter((event:any)=>['order.completed','order.confirmed'].includes(event.eventType))).toHaveLength(0);
}
export async function verifyNative(page:Page){await sendNative(page,'Verificar pagamento');}
export async function switchToCard(page:Page,journey:Journey,pix:any){
  const before=await journey.checkout(),card=await choosePayment(page,journey,'card'),after=await journey.checkout(),snapshot=await journey.finance();
  expect(snapshot.intents).toHaveLength(2);expect(snapshot.intents.find((row:any)=>row.id===pix.id).status).toBe('cancelled');
  expect(snapshot.intents.find((row:any)=>row.id===pix.id).creation.cancellation.state).toBe('cancelled');
  expect(card.id).not.toBe(pix.id);expect(card.amountCents).toBe(pix.amountCents);expect(card.amountBreakdown).toEqual(pix.amountBreakdown);
  expect(after.cart.items).toEqual(before.cart.items);expect(after.shipping.quoteId).toBe(before.shipping.quoteId);
  expect(snapshot.orders).toHaveLength(0);expect(snapshot.movements).toHaveLength(0);return card;
}
export async function clickHosted(page:Page,journey:Journey,card:any){
  expect(card.buyerFacing.invoiceUrl).toMatch(/^https:\/\/sandbox\.asaas\.com\/i\/captured_/);
  const link=journey.channel==='whatsapp'?page.getByRole('link',{name:'Pagar pedido',exact:true}).last():
    page.getByRole('link',{name:'Continuar para o pagamento seguro',exact:true}).last();
  await expect(link).toHaveAttribute('href',card.buyerFacing.invoiceUrl);
  const opened=page.waitForEvent('popup');await link.click();const popup=await opened;
  await expect.poll(()=>blockedDestinations.get(page)?.includes(card.buyerFacing.invoiceUrl)).toBe(true);await popup.close();
}
export async function assertCardToPixRefused(page:Page,journey:Journey,pix:any,card:any){
  if(journey.channel==='whatsapp'){
    await sendNative(page,'',currentMethod(page,journey,'pix',true));
    await expect(page.getByRole('log',{name:'Mensagens capturadas',exact:true})).toContainText('Mantive o pagamento atual e não gerei outra cobrança');
  }else{
    const response=page.waitForResponse(value=>new URL(value.url()).pathname.endsWith('/embed/checkout/edit')&&value.request().method()==='POST');
    await currentMethod(page,journey,'pix',true).click();expect((await response).status()).toBe(409);
    await expect(page.getByRole('log',{name:'Mensagens do chat',exact:true})).toContainText('Ainda não foi possível trocar a forma de pagamento');
  }
  const snapshot=await journey.finance();expect(snapshot.intents.map((row:any)=>row.id).sort()).toEqual([pix.id,card.id].sort());
  const preserved=snapshot.intents.find((row:any)=>row.id===card.id);
  expect(preserved.status).toMatch(/^(pending|requires_action)$/);expect(preserved.providerPaymentId).toBe(card.providerPaymentId);
  expect(preserved.creation.cancellation.reason).toBe('payment_cancellation_unsupported');
  expect(snapshot.intents.find((row:any)=>row.id===pix.id).status).toBe('cancelled');
  expect(snapshot.orders).toHaveLength(0);expect(snapshot.movements).toHaveLength(0);
}
export async function approveOnce(page:Page,journey:Journey,intent:any){
  const result=await journey.notify(intent.id);expect(result.status).toBe(200);
  await expect.poll(async()=>(await journey.finance()).intents.find((row:any)=>row.id===intent.id).status).toBe('approved');
  if(journey.channel==='whatsapp')await verifyNative(page);
  await expect(journey.channel==='whatsapp'?page.getByRole('log',{name:'Mensagens capturadas',exact:true}):page.getByRole('heading',{name:'Pagamento confirmado! 🎉',exact:true}))
    .toContainText(/pagamento (?:confirmado|aprovado)|pedido (?:registrado|confirmado)|compra concluída/i);
}
export async function assertPaid(page:Page,journey:Journey,before:any,intent:any){
  await expect.poll(async()=>{const state=await journey.finance();return[state.orders.length,state.sales.length,state.movements.length,state.stock[0]?.quantity,state.inventory[0]?.quantity];}).toEqual([1,1,1,19,19]);
  const paid=await journey.finance(),approval=paid.intents.find((row:any)=>row.id===intent.id),order=paid.orders[0];
  expect(approval.approvedAmountCents).toBe(intent.amountCents);expect(order.externalOrderId).toBe(intent.providerPaymentId);
  expect(order.currency).toBe('BRL');expect(order.status).toBe('approved');expect(Math.round(Number(order.orderTotal)*100)).toBe(4750);expect(order.shippingCents).toBe(750);
  expect(order.lineItemsJson.map((row:any)=>[row.variantId,row.quantity,row.unitPriceCents])).toEqual([[journey.variantId,1,4000]]);
  expect(paid.movements.map((row:any)=>[row.kind,row.quantity,row.reason,row.externalRef])).toEqual([['EXIT',1,'sale_completed',order.externalOrderId]]);
  expect(paid.sales[0].orderId).toBe(order.externalOrderId);expect(paid.stock[0].reserved).toBe(before.stock[0].reserved);
  expect(paid.inventory[0].reserved).toBe(before.inventory[0].reserved);expect(paid.appointments).toBe(0);expect(paid.attendanceReceipts).toBe(0);
  for(const type of['order.completed','order.confirmed'])expect(paid.events.filter((row:any)=>row.eventType===type)).toHaveLength(1);
  expect(paid.events.filter((row:any)=>row.eventType==='payment.status.changed'&&row.payload.status==='approved'&&row.payload.payment_intent_id===intent.id)).toHaveLength(1);
  const duplicate=await journey.notify(intent.id);expect(duplicate.status).toBe(200);
  const after=await journey.finance();expect(after.orders).toEqual(paid.orders);expect(after.sales).toEqual(paid.sales);
  expect(after.movements).toEqual(paid.movements);expect(after.stock).toEqual(paid.stock);expect(after.inventory).toEqual(paid.inventory);expect(after.settlements).toEqual(paid.settlements);
  const facts=(state:any)=>state.events.filter((row:any)=>/^(?:order\.|payment\.)/.test(row.eventType));expect(facts(after)).toEqual(facts(paid));
  const evidence=journey.evidence();expect(evidence.api.providerCalls).toBe(0);expect(evidence.api.localCapturedProductPayments.externalProviderCalls).toBe(0);
  // These assertions prove canonical outbox/SQL/UI only, not Graph/Resend delivery.
}
