import {test as base,expect,type Page,type Locator} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createProductContactDeliveryJourney} from '../../api/tests/product-contact-delivery.fixture.mjs';
type Journey=Awaited<ReturnType<typeof createProductContactDeliveryJourney>>;
export const test=base.extend<{}, {deliveryChannel:'storefront'|'whatsapp';deliveryScenario:'identity'|'freight';journey:Journey}>({
  deliveryChannel:['storefront',{option:true,scope:'worker'}],deliveryScenario:['identity',{option:true,scope:'worker'}],
  journey:[async({deliveryChannel,deliveryScenario},use)=>{const own=await createProductContactDeliveryJourney(deliveryChannel,deliveryScenario);try{await use(own);}finally{await own.close();}},{scope:'worker'}],
});
const native=(page:Page,label:string|RegExp)=>page.getByRole('log',{name:'Mensagens capturadas',exact:true}).getByRole('button',{name:label,exact:typeof label==='string'}).last();
const embedResponse=(response:any)=>new URL(response.url()).pathname.endsWith('/embed/chat')&&response.request().method()==='POST';
async function setup(page:Page,journey:Journey){
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===journey.origin?route.continue():route.abort('blockedbyclient'));
  await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const label=document.createElement('aside');label.textContent='Dados sintéticos · Entrega própria por bairro · ViaCEP/e-mail/Meta capturados localmente · Sem cobrança/envio externo';Object.assign(label.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'20000',padding:'5px',background:'#143d2b',color:'white',font:'11px system-ui',pointerEvents:'none'});document.body.append(label);}));
  if(journey.channel==='whatsapp')await page.goto(journey.origin);
}
async function sendNative(page:Page,message:string,button?:Locator){
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/send'&&response.request().method()==='POST');
  if(button){expect(await button.getAttribute('data-control-id')).toMatch(/^zyon:[a-f0-9]{32}$/);await button.focus();await page.keyboard.press('Enter');}
  else{const input=page.getByRole('textbox',{name:'Mensagem',exact:true});await input.fill(message);await input.press('Enter');}
  const response=await pending;expect(response.status()).toBe(200);expect((await response.json()).status).toBe('processed');await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');
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
    const detail=page.getByRole('dialog',{name:'Detalhes do produto',exact:true});await expect(detail).toContainText(journey.names.product);
    const response=page.waitForResponse(value=>new URL(value.url()).pathname.endsWith('/messages')&&value.request().method()==='POST');
    await detail.getByRole('button',{name:'Adicionar ao carrinho',exact:true}).first().click();const reply=await response;expect(reply.status()).toBe(201);
    expect((await reply.json()).blocks.some((block:any)=>block.type==='cart_add_result'&&block.data.status==='succeeded'&&block.data.variantId===journey.variantId)).toBe(true);
    await detail.getByRole('button',{name:'Fechar produto e voltar ao chat',exact:true}).click();
  }else{
    await sendNative(page,'/produtos');await sendNative(page,'',native(page,'Ver detalhes'));await sendNative(page,'',native(page,/^Adicionar(?: ao carrinho)?$/));
  }
  await expect.poll(async()=>{const row=await journey.cart();return row?.items.map((item:any)=>[item.variantId,item.quantity,item.unitPriceCents]);}).toEqual([[journey.variantId,1,4000]]);
  const cart=await journey.cart();expect(cart.total).toBe(4000);expect(cart.discount).toBe(0);return cart;
}
async function loginAndOpenCheckout(page:Page,journey:Journey){
  if(journey.channel==='whatsapp'){await sendNative(page,'/carrinho');await sendNative(page,'',native(page,/^Finalizar (?:pedido|compra)$/i));return;}
  await page.getByRole('button',{name:/^Carrinho(?::|$)/}).last().click();await page.getByRole('dialog',{name:'Carrinho',exact:true}).getByRole('button',{name:'Finalizar pedido',exact:true}).click();
  const dialog=page.getByRole('dialog').filter({has:page.getByText('Para finalizar sua compra, confirme sua identidade',{exact:true})});await expect(dialog).toBeVisible();
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
async function canonical(journey:Journey,cartId:string){
  const current=await journey.cart();expect(current.cartId).toBe(cartId);expect(current.items.map((row:any)=>[row.variantId,row.quantity,row.unitPriceCents])).toEqual([[journey.variantId,1,4000]]);expect(current.total).toBe(4000);expect(current.discount).toBe(0);
  const checkout=await journey.checkout();expect(checkout.merchantId).toBe(journey.merchantId);expect(checkout.cart.cart_ref).toBe(cartId);expect(checkout.cart.items.map((row:any)=>[row.variantId,row.quantity,row.price])).toEqual([[journey.variantId,1,40]]);expect(checkout.cart.total).toBe(40);expect(checkout.paymentMethod).toBeFalsy();return checkout;
}
async function noSale(journey:Journey,before:any){
  const after=await journey.snapshot();expect(after.stock).toEqual(before.stock);expect(after.foreignAddress).toEqual(before.foreignAddress);expect(after.financialEvents).toEqual(before.financialEvents);
  for(const key of['orders','intents','appointments','receipts','inventory'])expect(after[key]).toBe(0);const evidence=journey.evidence();expect(evidence.api.authOverrides).toBe(false);expect(evidence.api.repositoryOverrides).toBe(false);expect(evidence.api.providerCalls).toBe(0);expect(evidence.postal.externalPostalCalls).toBe(0);
}
async function capture(page:Page,label:string){const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');await mkdir(directory,{recursive:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:resolve(directory,`${label}-${page.viewportSize()?.width}.running.png`),fullPage:false});}
async function fillNewAddress(page:Page,journey:Journey,number:string){
  const log=page.getByRole('log',{name:journey.channel==='whatsapp'?'Mensagens capturadas':'Mensagens do chat',exact:true});
  await expect(log).toContainText(/Rua (?:Casa|Trabalho) Sintética/);await send(page,journey,'Sim',journey.channel==='whatsapp'?native(page,'Sim'):log.getByRole('button',{name:'Sim',exact:true}).last());
  await send(page,journey,number);await send(page,journey,'sem complemento');
}
async function selectOwnDelivery(page:Page,journey:Journey,neighborhood:'Centro'|'Jardins',cents:number){
  const checkout=await journey.checkout(),options=checkout.shippingOptions;expect(options).toHaveLength(1);expect(options[0].carrierKey).toBe('own_delivery_neighborhood_'+neighborhood.toLowerCase());expect(Math.round(options[0].customerPrice*100)).toBe(cents);
  expect(options[0].deliveryDays).toBe(1);expect(options[0].quoteId).toBeTruthy();expect(Date.parse(options[0].expiresAt)).toBeGreaterThan(Date.now());
  const log=page.getByRole('log',{name:journey.channel==='whatsapp'?'Mensagens capturadas':'Mensagens do chat',exact:true});await expect(log).toContainText(neighborhood);await expect(log).not.toContainText(/Correios|Sedex|PAC|retirada/i);
  const choice=journey.channel==='whatsapp'?native(page,new RegExp('Entrega própria.*'+neighborhood)):log.getByRole('button').filter({hasText:new RegExp('Entrega própria.*'+neighborhood)}).last();const response=await send(page,journey,'',choice);
  const shown=journey.channel==='storefront'?response.experience.totals:(await journey.view()).blocks.find((block:any)=>block.type==='checkout_summary')?.data.totals;
  expect(shown).toBeTruthy();expect(shown.currency).toBe('BRL');expect(shown.subtotal).toBe(40);expect(Math.round(shown.shipping*100)).toBe(cents);expect(shown.discount).toBe(0);
  const fee=journey.evidence().api.localContactDelivery.platformFeeBrl;expect(Number.isFinite(fee)&&fee>=0).toBe(true);expect(shown.service_fee).toBe(fee);
  expect(Math.round(shown.total*100)).toBe(4000+cents);expect(Math.round(shown.total_to_pay*100)).toBe(4000+cents+Math.round(fee*100));
  const selected=await journey.checkout();expect(selected.shipping.carrierKey).toBe(options[0].carrierKey);expect(selected.shipping.quoteId).toBe(options[0].quoteId);expect(Math.round(selected.shipping.customerPrice*100)).toBe(cents);return selected;
}
export async function runIdentityAddress(page:Page,journey:Journey){
  await setup(page,journey);const before=await journey.snapshot(),cart=await add(page,journey);await loginAndOpenCheckout(page,journey);
  if(journey.channel==='storefront'){
    const initial=await journey.checkout();expect(initial.globalUserId).toBe(journey.buyerId);expect(initial.customer.email_verified).toBe(true);expect(initial.customer.address).toEqual(journey.addresses.home);
    await send(page,journey,journey.phone);await canonical(journey,cart.cartId);await send(page,journey,'Entregar no trabalho');
    await expect.poll(async()=>(await journey.checkout()).customer.address.zip).toBe(journey.addresses.work.zip);
    await send(page,journey,'Sim',page.getByRole('log',{name:'Mensagens do chat',exact:true}).getByRole('button',{name:'Sim',exact:true}).last());
    await send(page,journey,'Alterar número para 25');const result=await canonical(journey,cart.cartId);expect(result.customer.address.number).toBe('25');expect(result.customer.address.zip).toBe(journey.addresses.work.zip);
  }else{
    let session=await journey.checkout();expect(session.customer.phone_verified).toBe(true);expect(session.customer.phone.replace(/\D/g,'')).toBe(journey.phone);
    await send(page,journey,journey.email);await send(page,journey,journey.names.buyer);await send(page,journey,journey.addresses.home.zip);await fillNewAddress(page,journey,'10');
    session=await canonical(journey,cart.cartId);expect(session.customer.email).toBe(journey.email);expect(session.customer.fullName).toBe(journey.names.buyer);expect(session.customer.address).toEqual(journey.addresses.home);expect(session.customer.email_verified).not.toBe(true);
    expect(journey.postal().some((event:any)=>event.zip===journey.addresses.home.zip)).toBe(true);
  }
  await noSale(journey,before);await capture(page,'c60-s4-'+journey.channel+'-identity-address');
}
export async function runOwnDeliveryFreight(page:Page,journey:Journey){
  await setup(page,journey);const before=await journey.snapshot(),cart=await add(page,journey);
  let initialNeighborhood:'Centro'|'Jardins'='Centro',initialCents=750;
  if(journey.channel==='whatsapp'){
    await sendNative(page,'/enderecos');await expect(page.getByRole('log')).not.toContainText('Endereço de outra conta');await sendNative(page,'',native(page,/Trabalho/));
    await sendNative(page,'',native(page,'Editar endereço'));await sendNative(page,'',native(page,'Número'));await sendNative(page,'25');
    const work=(await journey.book()).find((row:any)=>row.label==='Trabalho');expect(work.number).toBe('25');expect(await journey.checkout()).toBeNull();
    await sendNative(page,'/enderecos');await sendNative(page,'',native(page,/Trabalho/));await sendNative(page,'',native(page,'Usar como padrão'));expect((await journey.book()).find((row:any)=>row.isDefault)?.label).toBe('Trabalho');
    expect((await journey.cart()).cartId).toBe(cart.cartId);initialNeighborhood='Jardins';initialCents=1250;
  }
  await loginAndOpenCheckout(page,journey);let current=await canonical(journey,cart.cartId);expect(current.globalUserId).toBe(journey.buyerId);expect(current.customer.address.neighborhood).toBe(initialNeighborhood);
  const first=await selectOwnDelivery(page,journey,initialNeighborhood,initialCents),oldQuote=first.shipping.quoteId;
  const next=initialNeighborhood==='Centro'?journey.addresses.work:journey.addresses.home,nextNeighborhood=next.neighborhood as 'Centro'|'Jardins',nextCents=nextNeighborhood==='Centro'?750:1250;
  await send(page,journey,'Alterar endereço para '+next.zip);await fillNewAddress(page,journey,next.number);current=await canonical(journey,cart.cartId);
  expect(current.customer.address).toEqual(next);expect(current.shipping).toBeFalsy();expect(current.shippingOptions[0].quoteId).not.toBe(oldQuote);
  const selected=await selectOwnDelivery(page,journey,nextNeighborhood,nextCents);expect(selected.shipping.quoteId).not.toBe(oldQuote);expect(journey.postal().some((event:any)=>event.zip===next.zip)).toBe(true);
  const quotes=(await journey.snapshot()).quotes;expect(quotes.some((quote:any)=>quote.id===oldQuote)).toBe(true);expect(quotes.some((quote:any)=>quote.id===selected.shipping.quoteId&&quote.destinationZip===next.zip)).toBe(true);
  await noSale(journey,before);await capture(page,'c60-s4-'+journey.channel+'-own-delivery');
}
