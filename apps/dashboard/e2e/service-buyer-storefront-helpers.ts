import {test as base,expect,type Page,type Response,type Locator} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createBuyerBrowserJourney} from '../../api/tests/service-buyer-browser.fixture.mjs';

type Scenario='local'|'online'|'empty'|'conflict'|'expired'|'products';
type Journey=Awaited<ReturnType<typeof createBuyerBrowserJourney>>;
export function createBuyerTest(scenario:Scenario){return base.extend<{}, {journeyScenario:Scenario;journey:Journey}>({
  journeyScenario:[scenario,{option:true,scope:'worker'}],
  journey:[async({journeyScenario},use)=>{const owned=await createBuyerBrowserJourney(journeyScenario);
    try{await use(owned);}finally{await owned.close();}},{scope:'worker',timeout:600_000}],
});}
export {expect};
const bookingRequests=new WeakMap<Page,Array<{path:string;method:string;hasBuyerHeader:boolean}>>();
export const bookingTraffic=(page:Page)=>bookingRequests.get(page)??[];
const matches=(response:Response,suffix:string,method='GET')=>new URL(response.url()).origin==='http://127.0.0.1:5188'
  &&new URL(response.url()).pathname.endsWith(suffix)&&response.request().method()===method;
export async function declineOptionalStorefrontConsent(page:Page){
  const consent=page.getByRole('dialog',{name:'Sua privacidade nesta loja',exact:true});
  await expect(consent).toBeVisible();
  await consent.getByRole('button',{name:'N\u00e3o aceito',exact:true}).click();
  await expect(consent).toBeHidden();
}
export async function declineStorefrontMarketingOpening(page:Page){
  const marketingOpening=page.getByRole('region',{name:'Antes de come\u00e7ar',exact:true});
  await expect(marketingOpening).toBeVisible();
  await marketingOpening.getByRole('button',{name:'Agora n\u00e3o',exact:true}).click();
  await expect(marketingOpening).toBeHidden();
}
export async function openGuest(page:Page,journey:Journey){
  const traffic:Array<{path:string;method:string;hasBuyerHeader:boolean}>=[];bookingRequests.set(page,traffic);
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.includes('/service-booking/')||path.endsWith('/service-appointments/confirm'))traffic.push({path,method:request.method(),hasBuyerHeader:Boolean(request.headers()['x-buyer-access-token'])});});
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===journey.origin?route.continue():route.abort('blockedbyclient'));
  await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const label=document.createElement('aside');
    label.textContent='Next, API e banco locais · Dados sintéticos · Modelo e entrega de e-mail controlados';
    Object.assign(label.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'20000',padding:'5px',background:'#143d2b',color:'white',font:'11px system-ui',textAlign:'center',pointerEvents:'none'});document.body.append(label);}));
  await page.goto(journey.origin+'/store/'+journey.slug);
  await declineOptionalStorefrontConsent(page);
  await page.getByRole('button',{name:'Por chat Converse digitando',exact:true}).click();
  const input=page.getByRole('textbox',{name:'Mensagem',exact:true});await expect(input).toBeVisible();
  // C59: service companies start with their own published journey, before any typed request.
  for(const name of ['Quais serviços vocês oferecem?','Quais profissionais e horários estão disponíveis?','Falar com Humano'])
    await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  for(const name of ['Ver Produtos','Encontrar Produto','Categorias','Prazo de Entrega','Trocas e Devoluções','Rastrear Pedido','Ofertas'])
    await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  await expect(page.getByText(/Posso ajudar você a conhecer os serviços, escolher um profissional e consultar datas e horários\./)).toBeVisible();
  // The existing live marketing choice is separate from the initial privacy dialog.
  const marketingOpening=page.getByRole('region',{name:'Antes de come\u00e7ar',exact:true});
  await expect(marketingOpening).toBeVisible();
  await marketingOpening.getByRole('button',{name:'Agora n\u00e3o',exact:true}).click();
  await expect(marketingOpening).toBeHidden();
  const response=page.waitForResponse(value=>matches(value,'/messages','POST'));
  await input.fill('Gostaria de agendar uma consulta de orientação. Quais profissionais atendem?');await input.press('Enter');
  const reply=await response;expect(reply.status()).toBe(201);const body=await reply.json();
  expect(body.blocks.some((block:any)=>block.type==='service_booking'&&block.data.kind==='professionals'&&block.data.context?.productId===journey.offer.productId&&block.data.context?.variantId===journey.offer.variantId)).toBe(true);
  const panel=page.getByRole('region',{name:'Agendar serviço',exact:true}).last();
  await expect(panel.getByRole('button',{name:'Profissional Ana',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);expect((await journey.snapshot()).appointments).toEqual([]);
  expect(bookingTraffic(page).every(request=>request.method==='GET'&&!request.hasBuyerHeader)).toBe(true);return panel;
}
export async function identify(page:Page,journey:Journey,panel:Locator,chosen:unknown){
  expect(bookingTraffic(page).filter(request=>request.method==='POST')).toEqual([]);
  await panel.getByRole('button',{name:'Continuar agendamento',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);await expect(dialog.getByText('Vamos confirmar seus dados para reservar este horário',{exact:true})).toBeVisible();
  await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:/Entrar com e-mail/}).click();
  await dialog.getByRole('textbox',{name:'E-mail',exact:true}).fill(journey.email);
  const sent=page.waitForResponse(value=>matches(value,'/buyer/email/send','POST'));
  await dialog.getByRole('button',{name:'Confirmar',exact:true}).click();expect((await sent).status()).toBe(201);
  let code='';await expect.poll(()=>{try{code=journey.emailCode();return code;}catch{return'';}},{timeout:10000}).toMatch(/^\d{6}$/);
  await dialog.getByRole('textbox',{name:'Código de verificação',exact:true}).fill(code);
  const logged=page.waitForResponse(value=>matches(value,'/buyer/email/login/verify','POST'));
  const selected=page.waitForResponse(value=>matches(value,'/service-booking/select','POST'));
  await dialog.getByRole('button',{name:'Confirmar',exact:true}).click();const reply=await logged;expect(reply.status()).toBe(201);
  const auth=await reply.json();expect(auth.globalUserId??auth.global_user_id).toBe(journey.buyerId);await expect(dialog).toBeHidden();
  const selection=await selected;expect(selection.status()).toBe(201);expect(selection.request().postDataJSON().selection).toEqual(chosen);
  expect((await selection.json()).parent_cart_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  await expect(panel.getByRole('button',{name:'Revisar agendamento',exact:true})).toBeVisible();
  expect(bookingTraffic(page).filter(request=>request.method==='POST').map(request=>request.path.split('/').at(-1))).toEqual(['select']);
  expect((await journey.snapshot()).appointments).toEqual([]);return panel;
}
export async function selectSlot(page:Page,journey:Journey,panel:Locator){
  await panel.getByLabel('Consultar 31 dias a partir de',{exact:true}).fill(journey.date);
  const dates=page.waitForResponse(value=>matches(value,'/service-booking/dates'));
  const professional=panel.getByRole('button',{name:'Profissional Ana',exact:true});await professional.focus();await page.keyboard.press('Enter');
  const dateReply=await dates;expect(dateReply.status()).toBe(200);expect((await dateReply.json()).dates).toContain(journey.date);
  const label=new Intl.DateTimeFormat('pt-BR',{dateStyle:'long',timeZone:'America/Sao_Paulo'}).format(new Date(journey.date+'T12:00:00Z'));
  const slots=page.waitForResponse(value=>matches(value,'/service-booking/slots'));
  await panel.getByRole('button',{name:label,exact:true}).click();const slotReply=await slots;expect(slotReply.status()).toBe(200);
  const rows=(await slotReply.json()).selections;expect(rows.length).toBeGreaterThan(0);const chosen=rows[0];
  const time=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(chosen.startsAt));
  await panel.getByRole('button',{name:new RegExp('^'+time)}).click();
  expect(bookingTraffic(page).filter(request=>request.method==='POST')).toEqual([]);expect(bookingTraffic(page).every(request=>!request.hasBuyerHeader)).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);expect((await journey.snapshot()).appointments).toEqual([]);
  await expect(panel.getByText('Confira sua escolha',{exact:true})).toBeVisible();await expect(panel).toBeFocused();return chosen;
}
export async function prepare(page:Page,panel:Locator){
  const pending=page.waitForResponse(value=>matches(value,'/service-booking/prepare','POST'));
  await panel.getByRole('button',{name:'Revisar agendamento',exact:true}).click();const response=await pending;expect(response.status()).toBe(201);
  const prepared=await response.json();expect(prepared.confirmed).toBe(false);expect(prepared.cart_fingerprint).toMatch(/^[a-f0-9]{64}$/);return prepared;
}
export async function captureBuyer(page:Page,panel:Locator,name:string){
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');await mkdir(directory,{recursive:true});
  const gestureWidth=page.viewportSize()?.width;
  for(const[width,height,suffix]of[[1440,1000,'desktop'],[390,844,'mobile']]as const){await page.setViewportSize({width,height});
    await panel.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:resolve(directory,`${name}-gesture-${gestureWidth}-${suffix}.running.png`),fullPage:false});}
}
