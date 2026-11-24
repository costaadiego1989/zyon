import {createBuyerTest,expect,openGuest,identify,selectSlot,prepare,captureBuyer,declineOptionalStorefrontConsent,bookingTraffic} from './service-buyer-storefront-helpers.js';
const localTest=createBuyerTest('local'),onlineTest=createBuyerTest('online'),emptyTest=createBuyerTest('empty'),
  conflictTest=createBuyerTest('conflict'),expiredTest=createBuyerTest('expired'),productsTest=createBuyerTest('products');

localTest.describe('T45/T93 actual storefront local payment',()=>{
  const test=localTest;
  test('guest browses and chooses without login then real email OTP resumes only select before separate prepare and confirm',async({page,journey})=>{
    const panel=await openGuest(page,journey),before=await journey.snapshot();
    const selected=await selectSlot(page,journey,panel);await identify(page,journey,panel,selected);
    const reviewViewport=page.viewportSize();
    try{await captureBuyer(page,panel,'t45-real-storefront-review');}
    finally{if(reviewViewport)await page.setViewportSize(reviewViewport);}
    const prepared=await prepare(page,panel);expect(prepared.payment_mode).toBe('at_attendance');
    expect((await journey.snapshot()).appointments).toEqual([]);
    const confirmation=page.waitForResponse(value=>new URL(value.url()).pathname.endsWith('/embed/service-appointments/confirm')&&value.request().method()==='POST');
    const button=panel.getByRole('button',{name:'Confirmar e pagar no atendimento',exact:true});await button.focus();await page.keyboard.press('Enter');
    const response=await confirmation;expect(response.status()).toBe(201);const result=await response.json();expect(result.appointments).toHaveLength(1);
    await expect(panel.getByRole('heading',{name:'Agendamento confirmado',exact:true})).toBeVisible();await expect(panel.getByText('Pagamento pendente no atendimento.',{exact:true})).toBeVisible();
    const after=await journey.snapshot();expect(after.appointments).toHaveLength(1);const row=after.appointments[0];
    expect(row.id).toBe(result.appointments[0].id);expect(row.buyerGlobalUserId).toBe(journey.buyerId);expect(row.professionalId).toBe(journey.professionalId);
    expect(new Date(row.startsAt).toISOString()).toBe(selected.startsAt);expect(row.priceInCents).toBe(5000);expect(row.currency).toBe('BRL');expect(row.timeZone).toBe('America/Sao_Paulo');
    expect(row.operationalStatus).toBe('scheduled');expect(row.payments).toMatchObject([{mode:'at_attendance',status:'pending',receivedAt:null}]);
    expect(after.intents).toEqual([]);expect(after.receipts).toEqual([]);expect(after.stock).toEqual(before.stock);expect(after.inventory).toBe(before.inventory);
    expect(after.audits).toHaveLength(1);expect(after.events).toHaveLength(1);expect(journey.evidence().email).toEqual({capturedEmailCount:1,externalEmailDeliveries:0});
    expect(journey.evidence().api.providerCalls).toBe(0);await captureBuyer(page,panel,'t93-real-storefront-local-confirmed');
  });
});
onlineTest.describe('T45/T93 actual storefront online policy',()=>{
  const test=onlineTest;
  test('online prepare preserves selections and the existing checkout opens only after an explicit payment gesture',async({page,journey})=>{
    const panel=await openGuest(page,journey),selected=await selectSlot(page,journey,panel);await identify(page,journey,panel,selected);
    const prepared=await prepare(page,panel);expect(prepared.payment_mode).toBe('online');expect((await journey.snapshot()).appointments).toEqual([]);
    const start=page.waitForResponse(value=>new URL(value.url()).pathname.endsWith('/embed/start')&&value.request().method()==='POST');
    await panel.getByRole('button',{name:'Continuar para pagamento',exact:true}).click();const response=await start;expect(response.status()).toBe(201);
    const body=await response.json();expect(body.session_id??body.sessionId).toBe(prepared.session_id);
    const after=await journey.snapshot();expect(after.appointments).toEqual([]);expect(after.receipts).toEqual([]);expect(after.inventory).toBe(0);
    await expect(page.getByText('Agendamento confirmado',{exact:true})).toHaveCount(0);expect(journey.evidence().api.providerCalls).toBe(0);
    await expect(page.getByTitle('Voltar para o site',{exact:true})).toBeVisible();
    await captureBuyer(page,page.locator('.pulse-widget-shell').last(),'t93-real-storefront-online-checkout');
  });
});
emptyTest.describe('T45/T93 actual storefront empty availability',()=>{
  const test=emptyTest;
  test('an actual empty grade offers an honest empty state with no fabricated slot or write',async({page,journey})=>{
    const panel=await openGuest(page,journey),before=await journey.snapshot();
    await panel.getByLabel('Consultar 31 dias a partir de',{exact:true}).fill(journey.date);
    const dates=page.waitForResponse(value=>new URL(value.url()).pathname.endsWith('/service-booking/dates'));
    await panel.getByRole('button',{name:'Profissional Ana',exact:true}).click();const response=await dates;expect(response.status()).toBe(200);expect((await response.json()).dates).toEqual([]);
    await expect(panel.getByText('Nenhuma data disponível neste período. Escolha outro período ou profissional.',{exact:true})).toBeVisible();
    await expect(panel.getByRole('button',{name:'Revisar agendamento',exact:true})).toHaveCount(0);expect(await journey.snapshot()).toEqual(before);
    await expect(page.getByRole('dialog')).toHaveCount(0);expect(bookingTraffic(page).filter(request=>request.method==='POST')).toEqual([]);expect(journey.evidence().email).toEqual({capturedEmailCount:0,externalEmailDeliveries:0});
    await captureBuyer(page,panel,'t93-real-storefront-empty');
  });
});
conflictTest.describe('T45/T93 actual storefront capacity conflict',()=>{
  const test=conflictTest;
  test('a real competing admission after prepare is rejected without a second booking or financial write',async({page,journey})=>{
    const panel=await openGuest(page,journey),selected=await selectSlot(page,journey,panel);await identify(page,journey,panel,selected);await prepare(page,panel);
    const competitor=await journey.occupy(selected),before=await journey.snapshot();expect(before.appointments.map((row:any)=>row.id)).toEqual([competitor]);
    const rejected=page.waitForResponse(value=>new URL(value.url()).pathname.endsWith('/embed/service-appointments/confirm')&&value.request().method()==='POST');
    await panel.getByRole('button',{name:'Confirmar e pagar no atendimento',exact:true}).click();expect((await rejected).status()).toBe(409);
    await expect(panel.getByText('Agendamento confirmado',{exact:true})).toHaveCount(0);await expect(panel).toBeFocused();
    await expect(panel.getByRole('button',{name:'Atualizar disponibilidade',exact:true})).toBeVisible();expect(await journey.snapshot()).toEqual(before);
    await captureBuyer(page,panel,'t93-real-storefront-capacity-conflict');
  });
});
expiredTest.describe('T45/T93 actual storefront expired capability',()=>{
  const test=expiredTest;
  test('an expired writer capability receives real401 while anonymous browsing remains available without writes',async({page,journey})=>{
    let observed:any;
    page.on('response',response=>{if(new URL(response.url()).pathname==='/api/checkout-token'&&response.status()===200){
      const request=response.request(),body=request.postDataJSON();if(body.buyer_access_token)void response.json().then(data=>{
        observed={body,embedToken:data.embed_session_token,conversationToken:request.headers().authorization?.replace(/^Bearer /,'')};
      });}});
    const panel=await openGuest(page,journey),selected=await selectSlot(page,journey,panel);await identify(page,journey,panel,selected);
    await expect.poll(()=>Boolean(observed)).toBe(true);const shortened=await journey.expireObservedAccess(observed),before=await journey.snapshot();
    await expect.poll(()=>Date.now(),{timeout:10000}).toBeGreaterThan((shortened.expiresAtUnix+1)*1000);
    await page.route('**/api/embed/service-booking/prepare',route=>route.continue({headers:{...route.request().headers(),authorization:'Bearer '+shortened.token}}));
    const refused=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/service-booking/prepare'));
    await panel.getByRole('button',{name:'Revisar agendamento',exact:true}).click();const expiredResponse=await refused;expect(expiredResponse.status()).toBe(401);
    expect((await expiredResponse.json()).code).toBe('embed_session_token_expired');
    await expect(panel.getByText('Sua identificação precisa ser atualizada para continuar.',{exact:true})).toBeVisible();
    await expect(panel.getByRole('button',{name:'Profissional Ana',exact:true})).toHaveCount(0);await expect(panel).toBeFocused();
    expect(await journey.snapshot()).toEqual(before);await panel.getByRole('button',{name:'Consultar disponibilidade',exact:true}).click();
    await expect(panel.getByRole('button',{name:'Profissional Ana',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await journey.snapshot()).toEqual(before);await captureBuyer(page,panel,'t93-real-storefront-expired-capability');
  });
});
productsTest.describe('T93 actual storefront product preservation smoke',()=>{
  const test=productsTest;
  test('canonical product details and keyboard add gesture change the real cart without loading booking controls',async({page,journey})=>{
    await page.context().route('**/*',route=>new URL(route.request().url()).origin===journey.origin?route.continue():route.abort('blockedbyclient'));
    const serviceCalls:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname.includes('/service-booking/'))serviceCalls.push(request.url());});
    const before=await journey.snapshot();await page.goto(journey.origin+'/store/'+journey.slug+'?show=content&product='+journey.offer.productId);
    await declineOptionalStorefrontConsent(page);
    const detail=page.getByRole('dialog',{name:'Detalhes do produto',exact:true});await expect(detail).toBeVisible();
    await expect(detail.getByText('Produto físico local',{exact:true}).first()).toBeVisible();
    const add=detail.getByRole('button',{name:'Adicionar ao carrinho',exact:true}).first();await expect(add).toBeEnabled();await add.focus();await page.keyboard.press('Enter');
    await expect.poll(async()=>{const state=await journey.snapshot();return state.carts.some((cart:any)=>cart.items.some((item:any)=>item.variantId===journey.offer.variantId&&item.quantity===1));}).toBe(true);
    const after=await journey.snapshot();expect(after.appointments).toEqual([]);expect(after.intents).toEqual([]);expect(after.receipts).toEqual([]);
    expect(after.stock).toEqual(before.stock);expect(after.inventory).toBe(0);expect(serviceCalls).toEqual([]);
    await expect(page.getByRole('region',{name:'Agendar serviço',exact:true})).toHaveCount(0);
    await captureBuyer(page,detail,'t93-real-storefront-product-cart');
  });
});
