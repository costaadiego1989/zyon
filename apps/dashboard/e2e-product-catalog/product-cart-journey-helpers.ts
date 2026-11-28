import {test as base,expect,type Page,type Locator} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createProductCartJourney} from '../../api/tests/product-cart-journey.fixture.mjs';
import {declineOptionalStorefrontConsent,declineStorefrontMarketingOpening} from '../e2e/service-buyer-storefront-helpers.js';
import {declineWhatsAppMarketingOpening} from './product-catalog-read-helpers.js';
type Journey=Awaited<ReturnType<typeof createProductCartJourney>>;
const storefrontConsentHandled=new WeakSet<Page>();
const storefrontMarketingHandled=new WeakSet<Page>();
export const test=base.extend<{}, {cartChannel:'storefront'|'whatsapp';cartScenario:'mutations'|'crosssell';journey:Journey}>({
  cartChannel:['storefront',{option:true,scope:'worker'}],cartScenario:['mutations',{option:true,scope:'worker'}],
  journey:[async({cartChannel,cartScenario},use)=>{const own=await createProductCartJourney(cartChannel,cartScenario);try{await use(own);}finally{await own.close();}},{scope:'worker'}],
});
const native=(page:Page,label:string|RegExp)=>page.getByRole('log',{name:'Mensagens capturadas',exact:true}).getByRole('button',{name:label,exact:typeof label==='string'}).last();
async function setup(page:Page,journey:Journey){
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===journey.origin?route.continue():route.abort('blockedbyclient'));
  await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const label=document.createElement('aside');label.textContent='API/banco locais · Dados/regras sintéticos · Entrada Meta capturada ou Next real · Sem cobrança/envio externo';
    Object.assign(label.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'20000',padding:'5px',background:'#143d2b',color:'white',font:'11px system-ui',pointerEvents:'none'});document.body.append(label);}));
  if(journey.channel==='whatsapp')await page.goto(journey.origin);
}
async function send(page:Page,text:string,button?:Locator){
  const firstTurn=await page.getByRole('log',{name:'Mensagens capturadas',exact:true}).locator('article').count()===0;
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/send'&&response.request().method()==='POST');
  if(button){expect(await button.getAttribute('data-control-id')).toMatch(/^zyon:[a-f0-9]{32}$/);await button.focus();await page.keyboard.press('Enter');}
  else{const input=page.getByRole('textbox',{name:'Mensagem',exact:true});await input.fill(text);await input.press('Enter');}
  const response=await pending;expect(response.status()).toBe(200);expect((await response.json()).status).toBe('processed');await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');
  if(firstTurn)await declineWhatsAppMarketingOpening(page);
}
async function add(page:Page,journey:Journey,key:string){
  if(journey.channel==='storefront'){
    await page.goto(journey.origin+'/store/'+journey.slug+'?show=content&product='+journey.ids[key]);
    if(!storefrontConsentHandled.has(page)){await declineOptionalStorefrontConsent(page);storefrontConsentHandled.add(page);}
    if(!storefrontMarketingHandled.has(page)){await declineStorefrontMarketingOpening(page);storefrontMarketingHandled.add(page);}
    const dialog=page.getByRole('dialog',{name:'Detalhes do produto',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText(journey.names[key]);
    const response=page.waitForResponse(value=>new URL(value.url()).pathname.endsWith('/messages')&&value.request().method()==='POST');
    const cta=dialog.getByRole('button',{name:'Adicionar ao carrinho',exact:true}).first();await expect(cta).toBeEnabled();await cta.focus();await page.keyboard.press('Enter');
    const reply=await response;expect(reply.status()).toBe(201);expect(reply.request().postDataJSON().user_message).toContain('[variantId:'+journey.variants[key]+']');
    const body=await reply.json();expect(body.blocks.some((block:any)=>block.type==='cart_add_result'&&block.data.status==='succeeded'&&block.data.variantId===journey.variants[key])).toBe(true);
    const close=dialog.getByRole('button',{name:'Fechar produto e voltar ao chat',exact:true});if(!body.blocks.some((block:any)=>block.type==='cross_sell')&&await close.isVisible())await close.click();
    return body;
  }
  await send(page,'/produtos');const card=page.getByRole('log',{name:'Mensagens capturadas',exact:true}).locator('article').filter({hasText:journey.names[key]}).filter({has:page.getByRole('button',{name:'Ver detalhes',exact:true})}).last();
  await send(page,'',card.getByRole('button',{name:'Ver detalhes',exact:true}));await send(page,'',native(page,'🛒 Adicionar'));return await journey.view();
}
async function state(journey:Journey,expected:Record<string,{quantity:number;unitPrice?:number}>){
  await expect.poll(async()=>{const current=await journey.state();return current.items.map((item:any)=>[item.variantId,item.quantity]).sort();}).toEqual(Object.entries(expected).map(([key,value])=>[journey.variants[key],value.quantity]).sort());
  const current=await journey.state();let total=0;
  for(const[key,wanted]of Object.entries(expected)){const row=current.items.find((item:any)=>item.variantId===journey.variants[key]);expect(row.productId).toBe(journey.ids[key]);expect(row.unitPriceCents).toBe(wanted.unitPrice??journey.prices[key]);total+=row.quantity*row.unitPriceCents;}
  expect(current.total).toBe(total);expect(current.discount).toBe(0);return current;
}
async function noSale(journey:Journey,before:any){
  const after=await journey.snapshot();expect(after.products).toEqual(before.products);expect(after.stock).toEqual(before.stock);expect(after.financialEvents).toEqual(before.financialEvents);
  for(const key of['orders','intents','appointments','receipts','inventory'])expect(after[key]).toBe(0);
  const evidence=journey.evidence();expect(evidence.authOverrides).toBe(false);expect(evidence.repositoryOverrides).toBe(false);expect(evidence.providerCalls).toBe(0);
}
async function capture(page:Page,label:string){const root=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');await mkdir(root,{recursive:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:resolve(root,`${label}-${page.viewportSize()?.width}.running.png`),fullPage:false});}
async function cart(page:Page){const existing=page.getByRole('dialog',{name:'Carrinho',exact:true});if(!await existing.isVisible())await page.getByRole('button',{name:/^Carrinho(?::|$)/}).last().click();await expect(existing).toBeVisible();return existing;}
async function patch(page:Page,dialog:Locator,name:string){const pending=page.waitForResponse(response=>new URL(response.url()).pathname.includes('/cart/')&&new URL(response.url()).pathname.includes('/items/')&&response.request().method()==='PATCH');
  const button=dialog.getByRole('button',{name,exact:true});await expect(button).toBeEnabled();await button.focus();await page.keyboard.press('Enter');expect((await pending).status()).toBe(200);}
async function editNative(page:Page,name:string,action:string){await send(page,'/carrinho');await send(page,'',native(page,'Editar itens'));
  await send(page,'',native(page,new RegExp('Editar item [\\s\\S]*'+name)));await send(page,'',native(page,action));}
export async function runCartMutations(page:Page,journey:Journey){
  await setup(page,journey);const before=await journey.snapshot();await add(page,journey,'a');const initial=await state(journey,{a:{quantity:1}});expect(initial.cartId).toBeTruthy();
  if(journey.channel==='storefront'){let dialog=await cart(page);await patch(page,dialog,'Aumentar quantidade de '+journey.names.a);await state(journey,{a:{quantity:2}});await dialog.getByRole('button',{name:'Fechar carrinho',exact:true}).click();}
  else await editNative(page,journey.names.a,'Adicionar uma unidade');await state(journey,{a:{quantity:2}});
  await add(page,journey,'d');await state(journey,{a:{quantity:2},d:{quantity:1}});
  if(journey.channel==='storefront'){const dialog=await cart(page);await patch(page,dialog,'Diminuir quantidade de '+journey.names.d);await dialog.getByRole('button',{name:'Fechar carrinho',exact:true}).click();}
  else await editNative(page,journey.names.d,'Remover item');await state(journey,{a:{quantity:2}});
  await page.reload();if(journey.channel==='storefront'){const dialog=await cart(page);await expect(dialog.getByLabel('Quantidade de '+journey.names.a,{exact:true})).toHaveText('2');expect((await journey.state()).cartId).toBe(initial.cartId);
    await patch(page,dialog,'Diminuir quantidade de '+journey.names.a);await state(journey,{a:{quantity:1}});await patch(page,dialog,'Diminuir quantidade de '+journey.names.a);await expect(dialog.getByText('Carrinho vazio',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Fechar carrinho',exact:true}).click();}
  else{await editNative(page,journey.names.a,'Retirar uma unidade');await state(journey,{a:{quantity:1}});await editNative(page,journey.names.a,'Remover item');await send(page,'/carrinho');await expect(page.getByRole('log')).toContainText(/carrinho.*vazio/i);}
  await state(journey,{});await add(page,journey,'a');const recovered=await state(journey,{a:{quantity:1}});expect(recovered.cartId).toBe(initial.cartId);
  await noSale(journey,before);await capture(page,'c60-s3-'+journey.channel+'-mutations');
}
const offerDialog=(page:Page)=>page.getByRole('dialog',{name:'Sugestões para completar seu pedido',exact:true});
function offerCard(page:Page,name:string){return offerDialog(page).getByRole('heading',{name,exact:true}).locator('xpath=../..');}
export async function runCrossSell(page:Page,journey:Journey){
  await setup(page,journey);const before=await journey.snapshot();const quotes:any[]=[],postReads:any[]=[],accepts:any[]=[];
  page.on('response',response=>{const url=new URL(response.url());if(response.request().method()==='POST'&&url.pathname.endsWith('/cross-sell/quote')&&response.status()===201)void response.json().then(value=>quotes.push(value));
    if(response.request().method()==='POST'&&url.pathname.endsWith('/cross-sell/accept'))accepts.push(response);
    if(response.request().method()==='GET'&&url.searchParams.has('post_add_variant_id'))postReads.push(response);});
  await add(page,journey,'a');await state(journey,{a:{quantity:1}});
  if(journey.channel==='storefront'){
    await expect(offerDialog(page)).toBeVisible();await expect(offerDialog(page)).toContainText(journey.names.b);await expect(offerDialog(page)).not.toContainText(journey.names.out);await expect(offerDialog(page)).not.toContainText(journey.names.foreign);
    await expect.poll(()=>quotes.some(quote=>quote.variantId===journey.variants.b)).toBe(true);const quote=quotes.find(value=>value.variantId===journey.variants.b);expect(quote.maximumUnitPriceCents).toBe(1800);expect(quote.originalUnitPriceCents).toBe(2000);
    const image=offerCard(page,journey.names.b).locator('[role="button"]').first();await image.focus();await page.keyboard.press('Enter');
    const detail=page.getByRole('dialog',{name:'Detalhes do produto',exact:true});await expect(detail).toBeVisible();await expect(detail).toContainText(journey.names.b);
    const accepting=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/cross-sell/accept')&&response.request().method()==='POST');
    await detail.getByRole('button',{name:'Adicionar ao carrinho',exact:true}).first().click();const response=await accepting;expect(response.status()).toBe(201);expect(response.request().postDataJSON().expectedQuote.variantId).toBe(journey.variants.b);
    await state(journey,{a:{quantity:1},b:{quantity:1,unitPrice:1800}});await expect.poll(()=>postReads.length).toBeGreaterThan(0);expect(new URL(postReads[0].url()).searchParams.get('post_add_variant_id')).toBe(journey.variants.b);
    await expect(offerDialog(page)).toContainText(journey.names.c);expect(accepts).toHaveLength(1);await capture(page,'c60-s3-next-next-recommendation');
    // Reuse only the genuine read credential inside the same browser origin.
    // Browser Fetch Metadata and the original proxy/API guards remain in force.
    const genuine=postReads[0],headers=await genuine.request().allHeaders(),authorization=headers.authorization;
    expect(authorization).toMatch(/^Bearer \S+$/i);expect(genuine.headers()['cache-control']).toContain('no-store');
    const readStatus=async(url:string)=>page.evaluate(async({url,authorization})=>{
      const response=await fetch(url,{headers:{Authorization:authorization},cache:'no-store'});
      return{status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
    },{url,authorization});
    const stable=await journey.state(),foreignRead=new URL(genuine.url());foreignRead.searchParams.set('post_add_variant_id',journey.variants.foreign);
    expect((await readStatus(foreignRead.href)).status).toBe(404);expect(await journey.state()).toEqual(stable);
    const duplicate=new URL(genuine.url());duplicate.searchParams.append('post_add_variant_id',journey.variants.c);
    expect((await readStatus(duplicate.href)).status).toBe(400);expect(await journey.state()).toEqual(stable);
    const plain=new URL(genuine.url());plain.searchParams.delete('post_add_variant_id');const oldRead=await readStatus(plain.href);
    expect(oldRead.status).toBe(200);expect(oldRead.cache).toContain('no-store');expect(oldRead.body.cartId).toBe(stable.cartId);
    expect(Object.prototype.hasOwnProperty.call(oldRead.body,'postCartSuggestions')).toBe(false);expect(await journey.state()).toEqual(stable);
    const beforeDecline=await journey.state();await offerDialog(page).getByRole('button',{name:'Continuar comprando',exact:true}).click();expect(await journey.state()).toEqual(beforeDecline);
  }else{
    let view=await journey.view();const pending=view.blocks.find((block:any)=>block.type==='post_cart_offer');expect(pending).toBeTruthy();expect(JSON.stringify(view.blocks)).toContain(journey.names.b);expect(JSON.stringify(view.blocks)).not.toContain(journey.names.out);expect(JSON.stringify(view.blocks)).not.toContain(journey.names.foreign);
    await send(page,'',native(page,'Ver detalhes'));await expect(page.getByRole('log')).toContainText(journey.names.b);await send(page,'',native(page,'Adicionar'));
    await state(journey,{a:{quantity:1},b:{quantity:1,unitPrice:1800}});view=await journey.view();expect(JSON.stringify(view.blocks)).toContain(journey.names.c);expect(view.blocks.some((block:any)=>block.type==='post_cart_offer')).toBe(true);
    const beforeDecline=await journey.state();await send(page,'',native(page,'Não, obrigado'));expect(await journey.state()).toEqual(beforeDecline);
  }
  await add(page,journey,'d');await state(journey,{a:{quantity:1},b:{quantity:1,unitPrice:1800},d:{quantity:1}});
  if(journey.channel==='storefront'){
    await expect(offerDialog(page)).toContainText(journey.names.e);const product=offerCard(page,journey.names.e);await expect(product).not.toContainText(/exclusiv|grátis|gratuit|\d+%/i);await expect(product).toContainText('15,00');
    const unchanged=await journey.state();await offerDialog(page).getByRole('button',{name:'Continuar comprando',exact:true}).click();expect(await journey.state()).toEqual(unchanged);
  }else{const view=await journey.view();expect(JSON.stringify(view.blocks)).toContain(journey.names.e);expect(view.body).not.toMatch(/exclusiv|grátis|gratuit|\d+%/i);const unchanged=await journey.state();await send(page,'',native(page,'Não, obrigado'));expect(await journey.state()).toEqual(unchanged);}
  await noSale(journey,before);await capture(page,'c60-s3-'+journey.channel+'-crosssell');
}