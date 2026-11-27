import {test as base,expect,type Page,type Locator} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createProductDiscoveryReadJourney} from '../../api/tests/product-discovery-read.fixture.mjs';
import {declineOptionalStorefrontConsent} from '../e2e/service-buyer-storefront-helpers.js';
type Journey=Awaited<ReturnType<typeof createProductDiscoveryReadJourney>>;
export const test=base.extend<{}, {discoveryChannel:'storefront'|'whatsapp';discoverySurface:'categories'|'comparison'|'reviews';journey:Journey}>({
  discoveryChannel:['storefront',{option:true,scope:'worker'}],discoverySurface:['categories',{option:true,scope:'worker'}],
  journey:[async({discoveryChannel,discoverySurface},use)=>{const owned=await createProductDiscoveryReadJourney(discoveryChannel,discoverySurface);try{await use(owned);}finally{await owned.close();}},{scope:'worker'}],
});
export {expect};
const block=(result:any,type:string)=>{const matches=result.blocks.filter((value:any)=>value.type===type);expect(matches).toHaveLength(1);return matches[0].data;};
async function open(page:Page,journey:Journey){
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===journey.origin?route.continue():route.abort('blockedbyclient'));
  await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const aside=document.createElement('aside');aside.textContent='Fonte/API/banco locais · Seleção de leitura e revisão controladas · Nenhum envio externo';
    Object.assign(aside.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'20000',padding:'5px',background:'#143d2b',color:'white',font:'11px system-ui',pointerEvents:'none'});document.body.append(aside);}));
  await page.goto(journey.channel==='storefront'?journey.origin+'/store/'+journey.slug:journey.origin);
  if(journey.channel==='storefront'){await declineOptionalStorefrontConsent(page);await page.getByRole('button',{name:'Por chat Converse digitando',exact:true}).click();}
  await expect(page.getByRole('textbox',{name:'Mensagem',exact:true})).toBeVisible();
}
async function act(page:Page,journey:Journey,text:string,button?:Locator){
  const path=journey.channel==='storefront'?'/messages':'/send';const pending=page.waitForResponse(response=>new URL(response.url()).origin===journey.origin&&new URL(response.url()).pathname.endsWith(path)&&response.request().method()==='POST');
  if(button){await expect(button).toBeEnabled();if(journey.channel==='whatsapp')expect(await button.getAttribute('data-control-id')).toMatch(/^zyon:[a-f0-9]{32}$/);await button.focus();await page.keyboard.press('Enter');}
  else{const input=page.getByRole('textbox',{name:'Mensagem',exact:true});await input.fill(text);await input.press('Enter');}
  const response=await pending;expect(response.status()).toBe(journey.channel==='storefront'?201:200);const body=await response.json(),request=response.request().postDataJSON();
  if(journey.channel==='storefront')return{...body,request};
  expect(body.status).toBe('processed');await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');return{...await journey.view(),request};
}
const native=(page:Page,label:string)=>page.getByRole('log',{name:'Mensagens capturadas',exact:true}).getByRole('button',{name:label,exact:true}).last();
async function knownProduct(page:Page,journey:Journey){
  const catalog=await act(page,journey,'/produtos',journey.channel==='storefront'?page.getByRole('button',{name:/^Ver Produtos$/i}).last():undefined);
  const products=block(catalog,'product_carousel').products;expect(products.map((value:any)=>value.id).sort()).toEqual((await journey.products()).map((value:any)=>value.id).sort());
  if(journey.channel==='storefront'){
    const card=page.locator('[data-aacp-carousel-product="'+journey.ids.a+'"]');await act(page,journey,'',card.getByRole('button',{name:'Saber mais',exact:true}));
    const dialog=page.getByRole('dialog',{name:'Detalhes do produto',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Fechar produto e voltar ao chat',exact:true}).click();await expect(dialog).toHaveCount(0);
  }else{
    const card=page.getByRole('log',{name:'Mensagens capturadas',exact:true}).locator('article').filter({hasText:journey.names.a}).filter({has:page.getByRole('button',{name:'Ver detalhes',exact:true})}).last();
    const detail=await act(page,journey,'',card.getByRole('button',{name:'Ver detalhes',exact:true}));expect(block(detail,'product_card').id).toBe(journey.ids.a);
  }
}
async function cleanReads(journey:Journey,before:any){
  const after=await journey.snapshot();for(const field of ['products','categories','reviews','financialEvents'])expect(after[field]).toEqual(before[field]);
  for(const field of ['orders','intents','appointments','receipts','inventory'])expect(after[field]).toBe(0);
  for(const cart of after.carts){expect(cart.items).toEqual([]);expect(Number(cart.total)).toBe(0);}
  const evidence=journey.evidence();expect(evidence.authOverrides).toBe(false);expect(evidence.repositoryOverrides).toBe(false);expect(evidence.providerCalls).toBe(0);
  expect(evidence.localStorefrontRoutingProfile).toMatchObject({configured:'structured',observed:'structured',selectorActive:true});expect(evidence).not.toHaveProperty('localServiceReleaseFixture');
}
async function capture(page:Page,label:string){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);const root=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');await mkdir(root,{recursive:true});
  await page.screenshot({path:resolve(root,`${label}-${page.viewportSize()?.width}.running.png`),fullPage:false});
}
export async function runCategories(page:Page,journey:Journey){
  await open(page,journey);const before=await journey.snapshot();const first=await act(page,journey,'Categorias',journey.channel==='storefront'?page.getByRole('button',{name:'Categorias',exact:true}).last():undefined);
  const actual=block(first,'category_carousel').categories,expected=await journey.categories();
  expect(actual.map((value:any)=>({id:value.id,name:value.name,productCount:value.productCount})).sort((a:any,b:any)=>a.id.localeCompare(b.id))).toEqual(expected);
  expect(actual).toHaveLength(2);expect(JSON.stringify(actual)).not.toContain(journey.categoryIds.foreign);
  let selected;
  if(journey.channel==='storefront'){
    const option=page.getByRole('navigation',{name:'Categorias da loja',exact:true}).getByRole('button').filter({hasText:'Áudio'});selected=await act(page,journey,'',option);
    expect(selected.request.ui_action).toMatchObject({tool:'search_products',args:{query:'*',categoryId:journey.categoryIds.audio}});
  }else{
    const card=page.getByRole('log',{name:'Mensagens capturadas',exact:true}).locator('article').filter({hasText:'Áudio'}).filter({has:page.getByRole('button',{name:'Exibir produtos',exact:true})}).last();
    selected=await act(page,journey,'',card.getByRole('button',{name:'Exibir produtos',exact:true}));
  }
  expect(block(selected,'product_carousel').products.map((row:any)=>row.id).sort()).toEqual((await journey.products(journey.categoryIds.audio)).map((row:any)=>row.id).sort());
  expect(JSON.stringify(selected.blocks)).not.toContain(journey.ids.c);expect(JSON.stringify(selected.blocks)).not.toContain(journey.ids.foreign);
  await cleanReads(journey,before);await capture(page,'c60-s2b-'+journey.channel+'-categories');
}
export async function runComparison(page:Page,journey:Journey){
  await open(page,journey);const before=await journey.snapshot();await knownProduct(page,journey);
  const first=await act(page,journey,'Compare '+journey.names.a+' com '+journey.names.b,journey.channel==='storefront'?page.getByRole('button',{name:'Comparar '+journey.names.a+' com similar',exact:true}).last():undefined);
  if(journey.channel==='storefront')expect(first.request).not.toHaveProperty('ui_action');
  const actual=block(first,'product_comparison').products,expected=(await journey.products()).filter((row:any)=>[journey.ids.a,journey.ids.b].includes(row.id));
  expect(actual.map((row:any)=>row.id)).toEqual(expected.map((row:any)=>row.id));
  for(const row of expected){expect(actual.find((item:any)=>item.id===row.id)).toMatchObject({id:row.id,name:row.name,price:row.price,attributes:row.attributes,inStock:row.inStock,rating:row.rating});}
  if(journey.channel==='storefront'){
    const table=page.getByRole('table',{name:'Tabela comparativa de produtos',exact:true}).last();await expect(table).toBeVisible();
    for(const row of expected){await expect(table).toContainText(row.name);await expect(table).toContainText(new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(row.price/100));}
  }else{
    const log=page.getByRole('log',{name:'Mensagens capturadas',exact:true});await expect(log).toContainText('Comparação de produtos');await expect(log).toContainText('Critério');
    for(const row of expected)await expect(log).toContainText(row.name);
  }
  await capture(page,'c60-s2b-'+journey.channel+'-comparison-table');
  const missing=await act(page,journey,'Compare '+journey.names.a+' com '+journey.names.foreign);
  expect(missing.blocks.some((value:any)=>value.type==='product_comparison')).toBe(false);expect(JSON.stringify(missing.blocks)).not.toContain(journey.ids.foreign);
  expect(missing.message??missing.body).toMatch(/não localizei|correspondência|quais produtos/i);
  const calls=journey.modelEvents().filter((event:any)=>event.result?.productReadToolCall);expect(calls).toHaveLength(2);
  for(const call of calls){expect(call.input.toolNames).toContain('compare_products');expect(call.result.productReadToolCall.name).toBe('compare_products');}
  await cleanReads(journey,before);await capture(page,'c60-s2b-'+journey.channel+'-comparison');
}
async function reviewsMatch(journey:Journey,result:any,filter?:string,cursor?:string){
  const data=block(result,'reviews'),expected=await journey.reviewPage(filter,cursor);expect(data.productId).toBe(journey.ids.a);expect(data.totalReviews).toBe(expected.totalReviews);expect(data.averageRating).toBe(expected.averageRating);
  expect(data.reviews.map((row:any)=>({id:row.id,rating:row.rating,text:row.text,date:row.date}))).toEqual(expected.reviews);
  expect(data.nextCursor??null).toBe(expected.nextCursor??null);expect(JSON.stringify(data)).not.toContain('Comentário não publicado');expect(JSON.stringify(data)).not.toContain('Comentário de outra loja');
  return data;
}
export async function runReviews(page:Page,journey:Journey){
  await open(page,journey);const before=await journey.snapshot();await knownProduct(page,journey);
  let requests=0;page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/messages')&&request.method()==='POST')requests++;});
  const first=await act(page,journey,'Ver avaliações',journey.channel==='storefront'?page.getByRole('button',{name:'Ver avaliações de '+journey.names.a,exact:true}).last():undefined);
  if(journey.channel==='storefront')expect(first.request).not.toHaveProperty('ui_action');const all=await reviewsMatch(journey,first);expect(all.reviews).toHaveLength(10);expect(all.totalReviews).toBe(12);expect(all.nextCursor).toBeTruthy();
  if(journey.channel==='storefront'){
    const article=page.getByText('12 avaliações',{exact:true}).last().locator('xpath=ancestor::article[1]');
    for(const row of all.reviews.slice(0,5))await expect(article.getByText(row.text,{exact:true})).toBeVisible();
    for(const row of all.reviews.slice(5))await expect(article.getByText(row.text,{exact:true})).toHaveCount(0);
    const prior=requests,more=article.getByRole('button',{name:'Ver mais',exact:true});await more.focus();await page.keyboard.press('Enter');
    for(const row of all.reviews)await expect(article.getByText(row.text,{exact:true})).toBeVisible();expect(requests).toBe(prior); // local reveal, not server cursor
  }else{
    const second=await act(page,journey,'',native(page,'Mais avaliações'));const tail=await reviewsMatch(journey,second,undefined,all.nextCursor);
    expect(tail.reviews).toHaveLength(2);expect(new Set([...all.reviews,...tail.reviews].map((row:any)=>row.id)).size).toBe(12);expect(tail.nextCursor??null).toBe(null);
  }
  for(const[filter,label]of[['positive','Positivas'],['negative','Negativas']]){
    const response=await act(page,journey,'Mostre apenas as avaliações '+(filter==='positive'?'positivas':'negativas')+' de '+journey.names.a,
      journey.channel==='whatsapp'?native(page,label):undefined);
    const data=await reviewsMatch(journey,response,filter);expect(data.reviews).toHaveLength(6);expect(data.reviews.every((row:any)=>filter==='positive'?row.rating>=4:row.rating<=2)).toBe(true);
  }
  if(journey.channel==='whatsapp')expect(journey.modelEvents().filter((event:any)=>event.kind==='providerFetch')).toEqual([]);
  await cleanReads(journey,before);await capture(page,'c60-s2b-'+journey.channel+'-reviews');
}