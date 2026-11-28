import {test as base,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createBuyerWhatsAppJourney} from '../../api/tests/service-buyer-whatsapp.fixture.mjs';

type Journey=Awaited<ReturnType<typeof createBuyerWhatsAppJourney>>;
function createBuyerTest(mode:'services'|'products'){return base.extend<{}, {buyerMode:'services'|'products';journey:Journey}>({
  buyerMode:[mode,{option:true,scope:'worker'}],
  journey:[async({buyerMode},use)=>{const owned=await createBuyerWhatsAppJourney(buyerMode);try{await use(owned);}finally{await owned.close();}},{scope:'worker',timeout:600_000}],
});}
const servicesTest=createBuyerTest('services'),productsTest=createBuyerTest('products');
async function open(page:Page,journey:Journey){
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===journey.origin?route.continue():route.abort('blockedbyclient'));
  await page.goto(journey.origin);await expect(page.getByText(/Transporte Meta capturado; sem envio/)).toBeVisible();
}
async function send(page:Page,text:string){
  const firstTurn=await page.getByRole('log',{name:'Mensagens capturadas'}).locator('article').count()===0;
  const processed=page.waitForResponse(value=>new URL(value.url()).pathname==='/send'&&value.request().method()==='POST');
  await page.getByRole('textbox',{name:'Mensagem',exact:true}).fill(text);await page.getByRole('textbox',{name:'Mensagem',exact:true}).press('Enter');
  const response=await processed;expect(response.status()).toBe(200);expect((await response.json()).status).toBe('processed');
  await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');
  // Preserve the live opening: the synthetic buyer declines its actual current button in the browser.
  if(firstTurn)await choose(page,/^Agora n\u00e3o$/);
}
async function choose(page:Page,name:RegExp){
  const button=page.getByRole('log',{name:'Mensagens capturadas'}).getByRole('button',{name}).last();await expect(button).toBeEnabled();
  const processed=page.waitForResponse(value=>new URL(value.url()).pathname==='/send'&&value.request().method()==='POST');
  await button.focus();await page.keyboard.press('Enter');const response=await processed;expect(response.status()).toBe(200);
  const body=response.request().postDataJSON();expect(body.interactiveId).toBeTruthy();expect(body).not.toHaveProperty('selection');
  await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');
}
async function capture(page:Page,name:string){const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');
  const gestureWidth=page.viewportSize()?.width;
  await mkdir(directory,{recursive:true});for(const[width,height,suffix]of[[1440,1000,'desktop'],[390,844,'mobile']]as const){
    await page.setViewportSize({width,height});await page.getByRole('log').scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:resolve(directory,`${name}-gesture-${gestureWidth}-${suffix}.running.png`),fullPage:false});}}

async function captureStage(page:Page,name:string){
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');
  const viewport=page.viewportSize();expect(viewport).not.toBeNull();
  await mkdir(directory,{recursive:true});await page.getByRole('log').locator('article').last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:resolve(directory,`${name}-gesture-${viewport!.width}-${viewport!.width===390?'mobile':'desktop'}.running.png`),fullPage:false});
}
servicesTest.describe('T93 local signed WhatsApp service buyer',()=>{
  const test=servicesTest;
  test('guest contact, actual offer/professional/date/slot controls, explicit prepare and confirm persist one unpaid appointment',async({page,journey})=>{
    await open(page,journey);const before=await journey.snapshot();await send(page,'/servicos');
    await choose(page,/Consulta local/);await choose(page,/Profissional Ana/);
    await captureStage(page,'t44-real-signed-whatsapp-dates');
    await choose(page,/\d{2}\/\d{2}\/\d{4}/);
    await captureStage(page,'t44-real-signed-whatsapp-slots');
    await choose(page,/\d{2}:\d{2}/);
    const reviewed:any=await journey.state();expect(reviewed.view.serviceBooking.model.step).toBe('review');expect((await journey.snapshot()).appointments).toEqual([]);
    await captureStage(page,'t44-real-signed-whatsapp-review');
    await choose(page,/Continuar agendamento/);expect((await journey.snapshot()).appointments).toEqual([]);
    await send(page,'guest@buyer-journey.example.test');await send(page,'Meu nome é Comprador Sintético');
    const prepared:any=await journey.state();expect(prepared.view.serviceBooking.model.step).toBe('prepared');expect((await journey.snapshot()).appointments).toEqual([]);
    await choose(page,/Confirmar agendamento/);const after=await journey.snapshot();expect(after.appointments).toHaveLength(1);
    const row=after.appointments[0];expect(row.origin).toBe('whatsapp');expect(row.operationalStatus).toBe('scheduled');expect(row.timeZone).toBe('America/Sao_Paulo');
    expect(row.professionalId).toBe(journey.professionalId);expect(row.productId).toBe(journey.productId);expect(row.priceInCents).toBe(5000);expect(row.currency).toBe('BRL');
    expect(row.payments).toMatchObject([{mode:'at_attendance',status:'pending',receivedAt:null}]);expect(after.intents).toEqual([]);expect(after.receipts).toEqual([]);
    expect(row.customerSnapshot).toMatchObject({email:'guest@buyer-journey.example.test'});expect(row.customerSnapshot.name).toMatch(/Comprador/);
    expect(after.stock).toEqual(before.stock);expect(after.inventory).toBe(0);expect(after.audits).toHaveLength(1);
    expect(after.events.some((event:any)=>event.eventType==='service.appointment.scheduled')).toBe(true);
    expect((await journey.state() as any).view.serviceBooking.model.step).toBe('confirmed');
    await expect(page.getByRole('log')).toContainText('Pagamento pendente no atendimento');
    const duplicate=page.waitForResponse(value=>new URL(value.url()).pathname==='/duplicate'&&value.request().method()==='POST');
    await page.getByRole('button',{name:'Reentregar última entrada',exact:true}).click();expect((await duplicate).status()).toBe(200);
    await expect(page.getByRole('status')).toHaveText('Entrada processada pela API local.');expect(await journey.snapshot()).toEqual(after);
    expect(journey.evidence().providerCalls).toBe(0);expect(journey.evidence().authOverrides).toBe(false);
    await capture(page,'t93-real-signed-whatsapp-local-confirmed');
  });
});
productsTest.describe('T93 local signed WhatsApp product preservation smoke',()=>{
  const test=productsTest;
  test('product details and actual add/cart controls preserve stock and create no service booking',async({page,journey})=>{
    await open(page,journey);const before=await journey.snapshot();await send(page,'/produtos');
    await expect(page.getByRole('log')).toContainText('Produto físico local');await choose(page,/^Ver detalhes$/);
    await choose(page,/Adicionar/);await send(page,'/carrinho');const after=await journey.snapshot();
    expect(after.appointments).toEqual([]);expect(after.intents).toEqual([]);expect(after.receipts).toEqual([]);expect(after.audits).toEqual([]);expect(after.events).toEqual([]);
    expect(after.stock).toEqual(before.stock);expect(after.inventory).toBe(0);expect(after.sessions.length).toBeGreaterThan(0);
    expect(after.sessions.some((row:any)=>row.cart.items.some((item:any)=>item.productId===journey.productId&&item.quantity===1))).toBe(true);
    await expect(page.getByRole('log')).toContainText('Produto físico local');expect(journey.evidence().providerCalls).toBe(0);
    await capture(page,'t93-real-signed-whatsapp-product-cart');
  });
});
