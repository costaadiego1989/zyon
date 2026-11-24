import {test as base,expect,type Page,type Response} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createProductSearchReadJourney} from '../../api/tests/product-search-read.fixture.mjs';
type Journey=Awaited<ReturnType<typeof createProductSearchReadJourney>>;
type Channel='storefront'|'whatsapp';type Scenario='positive'|'noeligible';
export const test=base.extend<{}, {searchChannel:Channel;searchScenario:Scenario;journey:Journey}>({
  searchChannel:['storefront',{option:true,scope:'worker'}],searchScenario:['positive',{option:true,scope:'worker'}],
  journey:[async({searchChannel,searchScenario},use)=>{const owned=await createProductSearchReadJourney(searchChannel,searchScenario);
    try{await use(owned);}finally{await owned.close();}},{scope:'worker'}],
});
export {expect};
export async function openSearch(page:Page,journey:Journey){
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===journey.origin?route.continue():route.abort('blockedbyclient'));
  await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const label=document.createElement('aside');
    label.textContent='API/banco locais · Perfil estruturado · Classificador e planejador controlados · Sem envio externo';
    Object.assign(label.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'20000',padding:'5px',background:'#143d2b',color:'white',font:'11px system-ui',textAlign:'center',pointerEvents:'none'});document.body.append(label);}));
  await page.goto(journey.channel==='storefront'?journey.origin+'/store/'+journey.slug:journey.origin);
  if(journey.channel==='storefront'){const activate=page.getByRole('button',{name:'Por chat',exact:true});if(await activate.isVisible())await activate.click();}
  else await expect(page.getByText(/Transporte Meta capturado; sem envio/)).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Mensagem',exact:true})).toBeVisible();
}
const ownPost=(response:Response,journey:Journey,path:string)=>new URL(response.url()).origin===journey.origin
  &&new URL(response.url()).pathname.endsWith(path)&&response.request().method()==='POST';
export async function sendQuery(page:Page,journey:Journey,text:string){
  const previousWire=journey.channel==='whatsapp'?await page.locator('article[data-wire-sequence]').evaluateAll(nodes=>Math.max(0,...nodes.map(node=>Number(node.getAttribute('data-wire-sequence'))))):0;
  const pending=page.waitForResponse(response=>ownPost(response,journey,journey.channel==='storefront'?'/messages':'/send'));
  const input=page.getByRole('textbox',{name:'Mensagem',exact:true});await input.fill(text);await input.press('Enter');
  const response=await pending;expect(response.status()).toBe(journey.channel==='storefront'?201:200);const raw=await response.json();
  if(journey.channel==='storefront'){expect(response.request().postDataJSON().user_message).toBe(text);return{message:raw.message,blocks:raw.blocks,previousWire};}
  expect(response.request().postDataJSON()).toEqual({text});expect(raw.status).toBe('processed');
  await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');const view=await journey.currentMetaView();
  return{message:view.body,blocks:view.blocks,previousWire};
}
export async function assertSearchTurn(page:Page,journey:Journey,result:any,ceiling:number){
  expect(Array.isArray(result.blocks)).toBe(true);expect(typeof result.message).toBe('string');
  expect(result.blocks.some((block:any)=>block.type==='service_booking')).toBe(false);
  expect(result.message).not.toMatch(/não consegui|não verifiquei|consulta ficou incompleta|não puderam ser verificadas/i);
  const expected=await journey.eligible(ceiling),carousels=result.blocks.filter((block:any)=>block.type==='product_carousel'),products=carousels.flatMap((block:any)=>block.data.products);
  expect(products.map((row:any)=>row.id)).toEqual(expected.map((row:any)=>row.id));
  for(const product of products){const row=expected.find((item:any)=>item.id===product.id)!;
    expect(product.name).toBe(row.name);expect(product.price).toBe(row.price);expect(product.price).toBeLessThanOrEqual(ceiling);
    expect(product.rating).toBe(row.rating);expect(product.reviewCount).toBe(row.reviewCount);expect(product.rating).toBeGreaterThanOrEqual(4);expect(product.inStock).toBe(true);}
  if(expected.length){expect(carousels).toHaveLength(1);expect(carousels[0].data.criteria).toMatchObject({version:1,query:'fone',maxPriceCents:ceiling,minRating:4,sortBy:'price_asc'});
    expect(result.message).toMatch(new RegExp('\\b'+expected.length+'\\s+opç'));
  }else{expect(products).toEqual([]);expect(result.message).toMatch(/não encontrei produtos disponíveis/i);
    expect(result.message).toMatch(/4 estrelas/i);expect(result.message).toMatch(/100/);}
  for(const name of journey.foreignNames)expect(JSON.stringify(result)).not.toContain(name);
  if(journey.channel==='storefront'){
    if(expected.length){const region=page.getByRole('region',{name:'Produtos da loja',exact:true}).last(),cards=region.locator('[data-aacp-carousel-product]');
      await expect(cards).toHaveCount(expected.length);
      expect(await cards.evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.aacpCarouselProduct))).toEqual(expected.map((row:any)=>row.id));
      for(const row of expected){const card=region.locator('[data-aacp-carousel-product="'+row.id+'"]');await expect(card).toContainText(row.name);await expect(card.getByRole('button',{name:'Adicionar ao carrinho',exact:true})).toBeEnabled();}
    }else await expect(page.locator('[data-aacp-carousel-product]')).toHaveCount(0);
  }else{
    const recent=await page.getByRole('log',{name:'Mensagens capturadas',exact:true}).locator('article').evaluateAll((nodes,after)=>nodes
      .filter(node=>Number(node.getAttribute('data-wire-sequence'))>after).map(node=>({text:node.textContent??'',buttons:Array.from(node.querySelectorAll('button')).map(button=>button.textContent??'')})),result.previousWire);
    const cards=recent.filter(row=>row.buttons.includes('Ver detalhes'));expect(cards).toHaveLength(expected.length);
    for(const row of expected){const card=cards.find(item=>item.text.includes(row.name));expect(card).toBeTruthy();
      expect(card!.text.replace(/\s/g,'')).toContain(new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(row.price/100).replace(/\s/g,''));}
    if(!expected.length)expect(recent.some(row=>row.text.match(/não encontrei produtos/i))).toBe(true);
  }
  await expect(page.getByRole('region',{name:'Agendar serviço',exact:true})).toHaveCount(0);
}
export async function assertReadOnly(journey:Journey,before:any){
  const after=await journey.snapshot();expect(after.catalog).toEqual(before.catalog);expect(after.reviews).toEqual(before.reviews);expect(after.stock).toEqual(before.stock);
  for(const field of ['orders','intents','appointments','receipts'])expect(after[field]).toEqual([]);expect(after.inventory).toBe(0);expect(after.financialEvents).toEqual(before.financialEvents);
  for(const cart of after.carts){expect(cart.items).toEqual([]);expect(Number(cart.total)).toBe(0);}
  const evidence=journey.evidence().api;expect(evidence.authOverrides).toBe(false);expect(evidence.repositoryOverrides).toBe(false);expect(evidence.providerCalls).toBe(0);
  expect(evidence).not.toHaveProperty('localServiceReleaseFixture');expect(evidence).not.toHaveProperty('localCapturedProductPayments');
  expect(evidence.localStorefrontRoutingProfile).toMatchObject({configured:'structured',observed:'structured',selectorActive:true});
}
export async function captureSearch(page:Page,name:string){
  await page.getByRole('textbox',{name:'Mensagem',exact:true}).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');await mkdir(directory,{recursive:true});
  await page.screenshot({path:resolve(directory,`${name}-gesture-${page.viewportSize()?.width}.running.png`),fullPage:false});
}