import {test as base,expect,type Page,type Locator,type Response} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createProductCatalogReadJourney} from '../../api/tests/product-catalog-read.fixture.mjs';

type Channel='storefront'|'whatsapp';
type Scenario='ten'|'empty';
type Journey=Awaited<ReturnType<typeof createProductCatalogReadJourney>>;
export const test=base.extend<{}, {catalogChannel:Channel;catalogScenario:Scenario;journey:Journey}>({
  catalogChannel:['storefront',{option:true,scope:'worker'}],catalogScenario:['ten',{option:true,scope:'worker'}],
  journey:[async({catalogChannel,catalogScenario},use)=>{const owned=await createProductCatalogReadJourney(catalogChannel,catalogScenario);
    try{await use(owned);}finally{await owned.close();}},{scope:'worker'}],
});
export {expect};
const owned=(response:Response,journey:Journey,suffix:string)=>new URL(response.url()).origin===journey.origin
  &&new URL(response.url()).pathname.endsWith(suffix)&&response.request().method()==='POST';
async function network(page:Page,journey:Journey){
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===journey.origin?route.continue():route.abort('blockedbyclient'));
}
export async function openStorefront(page:Page,journey:Journey){
  expect(journey.channel).toBe('storefront');await network(page,journey);
  await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const label=document.createElement('aside');
    label.textContent='Next/API/banco locais · Perfil estruturado explícito · Classificador controlado · Sem chamada externa';
    Object.assign(label.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'20000',padding:'5px',background:'#143d2b',color:'white',font:'11px system-ui',textAlign:'center',pointerEvents:'none'});document.body.append(label);}));
  await page.goto(journey.origin+'/store/'+journey.slug);
  const activate=page.getByRole('button',{name:'Por chat',exact:true});if(await activate.isVisible())await activate.click();
  await expect(page.getByRole('textbox',{name:'Mensagem',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Ver Produtos$/i}).last()).toBeVisible();
}
export async function clickCatalog(page:Page,journey:Journey){
  const pending=page.waitForResponse(response=>owned(response,journey,'/messages'));
  const button=page.getByRole('button',{name:/^Ver Produtos$/i}).last();await button.focus();await page.keyboard.press('Enter');
  const response=await pending;expect(response.status()).toBe(201);const body=await response.json();
  expect(Array.isArray(body.blocks)).toBe(true);expect(typeof body.message).toBe('string');return body;
}
export async function openWhatsApp(page:Page,journey:Journey){
  expect(journey.channel).toBe('whatsapp');await network(page,journey);await page.goto(journey.origin);
  await expect(page.getByText(/Transporte Meta capturado; sem envio/)).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Mensagem',exact:true})).toBeVisible();
}
export async function sendWhatsApp(page:Page,text:string){
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/send'&&response.request().method()==='POST');
  const input=page.getByRole('textbox',{name:'Mensagem',exact:true});await input.fill(text);await input.press('Enter');
  const response=await pending;expect(response.status()).toBe(200);expect((await response.json()).status).toBe('processed');
  await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');
}
export async function chooseWhatsApp(page:Page,button:Locator){
  await expect(button).toBeEnabled();const control=await button.getAttribute('data-control-id');expect(control).toMatch(/^zyon:[a-f0-9]{32}$/);
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/send'&&response.request().method()==='POST');
  await button.focus();await page.keyboard.press('Enter');const response=await pending;expect(response.status()).toBe(200);
  const body=response.request().postDataJSON();expect(Object.keys(body).sort()).toEqual(['interactiveId','text']);expect(body.interactiveId).toBe(control);
  await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');
}
export function catalogProducts(blocks:any[]){
  expect(Array.isArray(blocks)).toBe(true);return blocks.filter(block=>block.type==='product_carousel').flatMap(block=>{
    expect(Array.isArray(block.data?.products)).toBe(true);return block.data.products;});
}
export async function advanceToLastCard(page:Page,carousel:Locator){
  const track=carousel.getByLabel('Lista de produtos; deslize para explorar',{exact:true}),last=carousel.locator('[data-aacp-carousel-product]').last();
  const inside=()=>last.evaluate(node=>{const card=node.getBoundingClientRect(),track=node.parentElement!.getBoundingClientRect();
    return card.left>=track.left-1&&card.right<=track.right+1;});
  let gestures=0;
  for(;gestures<10&&!await inside();gestures++){
    const previous=await track.evaluate(node=>node.scrollLeft),next=carousel.getByRole('button',{name:'Próximos produtos',exact:true});
    await expect(next).toBeEnabled();await next.focus();await page.keyboard.press('Enter');
    await expect.poll(()=>track.evaluate(node=>node.scrollLeft)).toBeGreaterThan(previous);
  }
  expect(await inside()).toBe(true);expect(gestures).toBeGreaterThan(0);await expect(last).toBeInViewport();
}
export async function assertReadOnly(journey:Journey,before:any){
  const after=await journey.snapshot();expect(after.catalog).toEqual(before.catalog);expect(after.stock).toEqual(before.stock);
  expect(after.orders).toEqual([]);expect(after.intents).toEqual([]);expect(after.appointments).toEqual([]);expect(after.receipts).toEqual([]);
  expect(after.inventory).toBe(0);expect(after.financialEvents).toEqual(before.financialEvents);
  for(const cart of after.carts){expect(cart.items).toEqual([]);expect(Number(cart.total)).toBe(0);}
  expect(journey.evidence().api.authOverrides).toBe(false);expect(journey.evidence().api.repositoryOverrides).toBe(false);
  expect(journey.evidence().api).not.toHaveProperty('localServiceReleaseFixture');expect(journey.evidence().api).not.toHaveProperty('localCapturedProductPayments');
}
export async function captureCatalog(page:Page,target:Locator,name:string){
  await target.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');
  await mkdir(directory,{recursive:true});await page.screenshot({path:resolve(directory,`${name}-gesture-${page.viewportSize()?.width}.running.png`),fullPage:false});
}