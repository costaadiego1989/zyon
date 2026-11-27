import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createBuyerBrowserJourney} from '../../api/tests/service-buyer-browser.fixture.mjs';
import {openGuest} from './service-buyer-storefront-helpers.js';
import {attachServedArtifact,createServedDashboard,installServedReleaseTransport,releaseWidgetBytes,servedFrontendDigest,servedReleaseIdentity} from './service-served-artifact-observation.mjs';

test('T10',async({browser,request})=>{
  const captures=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures');
  await mkdir(captures,{recursive:true});
  for(const mode of ['products','services'] as const){
    const context=await browser.newContext({baseURL:'http://127.0.0.1:5187',viewport:{width:1280,height:900}});
    try{
      await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5187'?route.continue():route.abort('blockedbyclient'));
      const page=await context.newPage();
      const person=async()=>{
        await page.getByLabel('Nome completo').fill('Pessoa Sintética');
        await page.getByLabel('Cargo / papel na empresa').selectOption('owner');
        await page.getByRole('button',{name:'Continuar',exact:true}).click();
      };
      await page.goto('/?mode=signup');await person();
      await expect(page.getByRole('group',{name:'O que sua empresa vende?'})).toBeVisible();
      await expect(page.getByRole('radio',{checked:true})).toHaveCount(0);
      await page.getByRole('button',{name:'Continuar',exact:true}).click();
      await expect(page.getByRole('alert')).toContainText('Escolha se sua empresa vende');
      await page.getByRole('radio',{name:/Produtos/}).focus();await page.keyboard.press('Space');
      if(mode==='services')await page.keyboard.press('ArrowRight');
      await expect(page.locator(`input[value="${mode}"]`)).toBeChecked();
      await expect(page.getByRole('radio',{checked:true})).toHaveCount(1);
      await page.reload();await person();
      await expect(page.locator(`input[value="${mode}"]`)).toBeChecked();
      await page.getByLabel('Nome da loja').fill('Empresa Sintética '+mode);
      await page.getByLabel('CPF ou CNPJ').fill('52998224725');
      await page.evaluate(()=>{const label=document.createElement('p');label.textContent='Aplicação local · Cadastro sintético';Object.assign(label.style,{position:'fixed',bottom:'8px',left:'8px',margin:'0',padding:'8px 12px',background:'#143d2b',color:'#fff',font:'12px system-ui',zIndex:'1000',borderRadius:'6px'});document.body.append(label);});
      await page.screenshot({path:resolve(captures,`task10-signup-${mode}.running.png`),fullPage:true});
      await page.getByRole('button',{name:'Continuar',exact:true}).click();
      await page.getByLabel('E-mail corporativo').fill(`t10-${mode}@example.test`);
      await page.getByLabel('Senha',{exact:true}).fill('SyntheticPassword123!');
      await page.getByLabel('Confirmar senha').fill('SyntheticPassword123!');
      await page.getByLabel('Celular').fill('11999999999');
      let fail=true;
      await page.route('**/v1/auth/register',route=>{
        if(fail){fail=false;return route.fulfill({status:409,contentType:'application/json',body:'{"message":"email_already_registered"}'});}
        return route.continue();
      });
      await page.getByRole('button',{name:'Criar conta',exact:true}).click();
      await expect(page.getByRole('alert')).toContainText('Este e-mail já está cadastrado.');
      await page.getByRole('button',{name:'Voltar',exact:true}).click();
      await expect(page.locator(`input[value="${mode}"]`)).toBeChecked();
      await page.getByRole('button',{name:'Continuar',exact:true}).click();
      const registering=page.waitForResponse(response=>response.url().endsWith('/v1/auth/register')&&response.request().method()==='POST');
      const completing=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');
      await page.getByRole('button',{name:'Criar conta',exact:true}).click();
      const registered=await registering;expect(registered.status()).toBe(201);
      expect(registered.request().postDataJSON().business_mode).toBe(mode);
      const completed=await completing;expect(completed.status()).toBe(200);
      expect(completed.request().postDataJSON().business_mode).toBe(mode);
      const auth=await registered.json();
      const profile=await request.get('/v1/merchants/me',{headers:{authorization:'Bearer '+auth.access_token}});
      expect(profile.status()).toBe(200);const data=await profile.json();
      expect(data.businessMode).toBe(mode);expect(data.businessModeSelectionState).toBe('selected');
      expect(data.capabilities.serviceBooking).toBe(false);
      if(mode==='products')expect(data.capabilities.serviceAdministration).toBe(false);
      await page.reload();
      const reopened=await request.get('/v1/merchants/me',{headers:{authorization:'Bearer '+auth.access_token}});
      expect((await reopened.json()).businessMode).toBe(mode);
    }finally{await context.close();}
  }
  const seed=await request.post('/__service/signup-oauth');expect(seed.status()).toBe(200);
  const pending=await seed.json();
  const context=await browser.newContext({baseURL:'http://127.0.0.1:5187'});
  try{
    await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5187'?route.continue():route.abort('blockedbyclient'));
    const page=await context.newPage();await page.goto('/?mode=signin');
    await page.getByLabel('E-mail').fill(pending.email);await page.getByLabel('Senha',{exact:true}).fill(pending.password);
    await page.getByRole('button',{name:'Entrar',exact:true}).last().click();
    await expect(page.getByLabel('Nome completo')).toBeVisible();
    await page.getByLabel('Cargo / papel na empresa').selectOption('owner');await page.getByRole('button',{name:'Continuar',exact:true}).click();
    await page.getByRole('radio',{name:/Serviços/}).check();
    await page.getByLabel('Nome da loja').fill('OAuth Sintético');await page.getByLabel('CPF ou CNPJ').fill('52998224725');
    await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByLabel('Celular').fill('11999999999');
    const completing=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');
    await page.getByRole('button',{name:'Concluir cadastro',exact:true}).click();
    const completed=await completing;expect(completed.status()).toBe(200);expect(completed.request().postDataJSON().business_mode).toBe('services');
    const profile=await request.get('/v1/merchants/me',{headers:{authorization:'Bearer '+pending.access_token}});
    expect((await profile.json()).businessMode).toBe('services');
  }finally{await context.close();}
});

test('T3',async({page,context,request})=>{
  const origin='http://127.0.0.1:5187';
  const response=await request.get('/__service/manifest');
  expect(response.status()).toBe(200);
  const manifest=await response.json();
  expect(manifest.kind).toBe('local-owned');expect(manifest.origin).toBe(origin);
  expect(manifest.runId).toBe(process.env.SERVICE_LOCAL_RUN_ID);
  expect(manifest.metaConnected).toBe(false);expect(manifest.pspConnected).toBe(false);
  const blocked:string[]=[];
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    blocked.push(url.origin);return route.abort('blockedbyclient');
  });
  const captures=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures');
  await mkdir(captures,{recursive:true});
  await page.goto('/');
  await page.getByRole('button',{name:'Entrar',exact:true}).first().click();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
  await expect(page.getByRole('button',{name:/entrar|acessar/i}).first()).toBeVisible();
  await page.evaluate(()=>{const label=document.createElement('div');label.textContent='Aplicação local de teste · Sem conexão com produção';
    Object.assign(label.style,{position:'fixed',top:'0',left:'0',right:'0',padding:'8px',background:'#143d2b',color:'#fff',font:'13px system-ui',textAlign:'center',zIndex:'10000'});document.body.append(label);});
  await page.screenshot({path:resolve(captures,'task3-dashboard-login.running.png'),fullPage:true});
  await page.goto('/__service/whatsapp');
  await page.getByRole('button',{name:'Verificar API local'}).click();
  await expect(page.locator('output')).toHaveText('API local pronta. Banco conectado.');
  await page.screenshot({path:resolve(captures,'task3-whatsapp-fixture.running.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(captures,'task3-whatsapp-fixture-mobile.running.png'),fullPage:true});
  const outside=await page.evaluate(async()=>{try{await fetch('https://example.invalid/forbidden');return 'allowed';}catch{return 'blocked';}});
  expect(outside).toBe('blocked');expect(blocked).toContain('https://example.invalid');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

type ReleaseJourney=Awaited<ReturnType<typeof createBuyerBrowserJourney>>;
const servedTest=test.extend<{}, {releaseJourney:ReleaseJourney}>({
  releaseJourney:[async({},use)=>{
    const journey=await createBuyerBrowserJourney('local');
    try{await use(journey);}finally{await journey.close();}
  },{scope:'worker',timeout:600_000}],
});
servedTest('T93 measured Linux/Windows frontend artifacts are actually served and exercised without a booking write',async({browser,releaseJourney:journey},testInfo)=>{
  const before={runtime:servedReleaseIdentity(),frontends:{dashboard:servedFrontendDigest('dashboard'),widget:servedFrontendDigest('widget'),storefront:servedFrontendDigest('storefront')}};
  const dashboard=await createServedDashboard();
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage();
    const navigation=page.waitForResponse(response=>response.request().isNavigationRequest()&&new URL(response.url()).pathname==='/store/'+journey.slug);
    const message=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/messages')&&response.request().method()==='POST');
    const issued=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/checkout-token'&&response.request().method()==='POST');
    for(const pending of [navigation,message,issued])void pending.catch(()=>{});
    const panel=await openGuest(page,journey);await expect(panel.getByRole('button',{name:'Profissional Ana',exact:true})).toBeVisible();
    const nextResponse=await navigation;await attachServedArtifact(testInfo,'storefront',nextResponse,before);
    await page.screenshot({path:testInfo.outputPath('served-storefront.running.png'),fullPage:false});
    const messageResponse=await message;expect(messageResponse.status()).toBe(201);
    const data=(await messageResponse.json()).blocks.find((block:any)=>block.type==='service_booking'&&block.data.kind==='professionals')?.data;
    expect(data?.context).toMatchObject(journey.offer);
    const issuedResponse=await issued;expect(issuedResponse.ok()).toBe(true);const embedToken=(await issuedResponse.json()).embed_session_token;
    expect(typeof embedToken).toBe('string');expect(embedToken.length).toBeGreaterThan(1);
    const snapshot=await journey.snapshot();
    const owner=await journey.prepareServedOwnerDashboard();
    const loggedIn=await context.request.post(owner.apiOrigin+'/auth/login',{data:{email:owner.email,password:owner.password}});
    expect(loggedIn.status()).toBe(201);expect((await loggedIn.json()).merchant_id).toBe(journey.merchantId);
    await context.unroute('**/*');
    const allowed=new Set([journey.origin,dashboard.origin,'http://127.0.0.1:5187']);
    const forwarded=await installServedReleaseTransport(context,allowed,owner.apiOrigin);
    const prefix=journey.origin+'/__service/release-widget/';
    await page.addScriptTag({type:'importmap',content:JSON.stringify({imports:{react:prefix+'react.mjs','react-dom':prefix+'react-dom.mjs','react-dom/client':prefix+'react-dom-client.mjs','react/jsx-runtime':prefix+'jsx-runtime.mjs'}})});
    const styleResponse=await page.request.get(prefix+'asset-list.json');expect(styleResponse.status()).toBe(200);
    for(const name of (await styleResponse.json()).css)await page.addStyleTag({url:prefix+name});
    const library=page.waitForResponse(response=>response.url()===prefix+'index.js');void library.catch(()=>{});
    await page.evaluate(async({prefix,data,merchantId,embedToken,date})=>{
      const React=await import(prefix+'react.mjs');(globalThis as any).__zyonReleaseReact=React.default;
      const renderer=await import(prefix+'react-dom-client.mjs'),widget=await import(prefix+'index.js');
      const host=document.createElement('section');host.id='served-widget-release-proof';host.setAttribute('aria-label','Widget compilado da versao');document.body.append(host);
      renderer.createRoot(host).render(React.createElement(widget.ServiceBookingPicker,{data,access:null,
        readAccess:{merchantId,embedToken,apiBaseUrl:location.origin+'/api/v1',embedApiBaseUrl:location.origin+'/api'},initialFromDate:date}));
    },{prefix,data,merchantId:journey.merchantId,embedToken,date:journey.date});
    const widgetHost=page.locator('#served-widget-release-proof');
    await expect(widgetHost.getByRole('button',{name:'Profissional Ana',exact:true})).toBeEnabled();
    const dates=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/service-booking/dates')&&response.request().method()==='GET');
    await widgetHost.getByRole('button',{name:'Profissional Ana',exact:true}).click();const datesResponse=await dates;
    expect(datesResponse.status()).toBe(200);expect((await datesResponse.json()).dates).toContain(journey.date);
    await expect(widgetHost.getByRole('button',{name:/\d{4}/}).first()).toBeVisible();
    await attachServedArtifact(testInfo,'widget',await library,before,releaseWidgetBytes());
    await widgetHost.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('served-widget-library.running.png'),fullPage:false});
    expect(await journey.snapshot()).toEqual(snapshot);expect(journey.evidence().api.providerCalls).toBe(0);
    const admin=await context.newPage();
    const profile=admin.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/merchants/me'));
    const adminResponse=await admin.goto(dashboard.origin+'/#service-attendance?tab=professionals');expect(adminResponse).not.toBeNull();
    const profileResponse=await profile;expect(profileResponse.status()).toBe(200);
    const profileBody=await profileResponse.json(),me=profileBody.data??profileBody;
    expect(me.id).toBe(journey.merchantId);expect(me.businessMode).toBe('services');expect(String(me.role).toUpperCase()).toBe('OWNER');
    await expect(admin.getByRole('heading',{name:'Atendimento',exact:true})).toBeVisible();
    await expect(admin.getByRole('tabpanel',{name:'Profissionais',exact:true}).getByText('Profissional Ana',{exact:true})).toBeVisible();
    await admin.getByRole('tab',{name:'Disponibilidade',exact:true}).click();
    await admin.getByLabel('Profissional',{exact:true}).selectOption(journey.professionalId);
    const gradePath='/v1/merchants/'+journey.merchantId+'/service-professionals/'+journey.professionalId+'/availability';
    const grade=admin.waitForResponse(response=>new URL(response.url()).pathname===gradePath&&response.request().method()==='GET');
    await admin.getByRole('button',{name:'Consultar grade',exact:true}).click();const gradeResponse=await grade;expect(gradeResponse.status()).toBe(200);
    const actualGrade=await gradeResponse.json();expect(actualGrade.professionalId).toBe(journey.professionalId);
    expect(actualGrade.timeZone).toBe('America/Sao_Paulo');expect(actualGrade.rows).toHaveLength(7);
    expect(forwarded.some(row=>row.method==='GET'&&row.path===gradePath&&row.status===200)).toBe(true);
    expect(forwarded.every(row=>row.targetOrigin===owner.apiOrigin)).toBe(true);
    expect(await journey.snapshot()).toEqual(snapshot);expect(journey.evidence().api.providerCalls).toBe(0);
    await attachServedArtifact(testInfo,'dashboard',adminResponse!,before,dashboard.indexBytes);
    await admin.screenshot({path:testInfo.outputPath('served-dashboard.running.png'),fullPage:false});
  }finally{await context.close();await dashboard.close();}
});
