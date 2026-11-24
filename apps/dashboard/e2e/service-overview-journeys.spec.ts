import {test,expect,type APIRequestContext,type BrowserContext,type Page,type Response,type TestInfo} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='http://127.0.0.1:5187';
type Seed={fixtureId:string;email:string;password:string;merchant_id:string;user_id:string;mode:'products'|'services';role:'OWNER'|'ADMIN'|'STAFF';professionalA:string;professionalB:string;categoryA:string;categoryB:string;fromDate:string;emptyDate:string;review:boolean};
type Wire={method:string;path:string;search:string};
const matches=(response:Response,path:string)=>{const url=new URL(response.url());return url.origin===origin&&url.pathname===path;};
const metricPath=(seed:Seed)=>'/v1/merchants/'+seed.merchant_id+'/service-metrics';
const commerce=(path:string)=>/^\/v1\/(?:checkout\/(?:dashboard|funnel)|storefront\/funnel)\//.test(path);
async function seed(request:APIRequestContext,name:'services'|'products'|'admin'|'staff'|'review'):Promise<Seed>{
 const response=await request.post('/__service/overview/seed/'+name,{timeout:10000});
 expect(response.status()).toBe(200);return response.json();
}
async function control(request:APIRequestContext,name:'partial-on'|'partial-off'|'sql-failure-on'|'sql-failure-off'){
 const response=await request.post('/__service/overview/control/'+name,{timeout:10000});expect(response.status()).toBe(200);expect(await response.json()).toEqual({ok:true});
}
async function snapshot(request:APIRequestContext){
 const response=await request.get('/__service/overview/snapshot',{timeout:10000});expect(response.status()).toBe(200);return response.json();
}
function observe(page:Page){const reads:Wire[]=[];page.on('request',request=>{const url=new URL(request.url());if(url.origin===origin&&url.pathname.startsWith('/v1/'))reads.push({method:request.method(),path:url.pathname,search:url.search});});return reads;}
async function signIn(page:Page,context:BrowserContext,current:Seed,expectedProfile=200){
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
 await page.goto('/?mode=signin#overview');
 await page.getByLabel('E-mail',{exact:true}).fill(current.email);await page.getByLabel('Senha',{exact:true}).fill(current.password);
 const login=page.waitForResponse(response=>matches(response,'/v1/auth/login')&&response.request().method()==='POST');
 const profile=page.waitForResponse(response=>matches(response,'/v1/merchants/me'));
 await page.getByRole('button',{name:'Entrar',exact:true}).click();
 expect((await login).status()).toBe(201);const reply=await profile;expect(reply.status()).toBe(expectedProfile);
 if(expectedProfile===200){const raw=await reply.json(),me=raw.data??raw;expect(me.id).toBe(current.merchant_id);expect(me.businessMode).toBe(current.mode);expect(me.businessModeSelectionState).toBe(current.review?'review_required':'selected');}
}
async function apply(page:Page,current:Seed,fromDate=current.fromDate,toDate=fromDate,professionalId='',categoryId=''){
 await page.getByLabel('Data inicial',{exact:true}).fill(fromDate);await page.getByLabel('Data final',{exact:true}).fill(toDate);
 await expect(page.getByLabel('Profissional',{exact:true})).toBeEnabled();await page.getByLabel('Profissional',{exact:true}).selectOption(professionalId);
 await expect(page.getByLabel('Categoria de serviço',{exact:true})).toBeEnabled();await page.getByLabel('Categoria de serviço',{exact:true}).selectOption(categoryId);
 const response=page.waitForResponse(value=>matches(value,metricPath(current))&&new URL(value.url()).searchParams.get('fromDate')===fromDate&&new URL(value.url()).searchParams.get('toDate')===toDate&&new URL(value.url()).searchParams.get('professionalId')===(professionalId||null)&&new URL(value.url()).searchParams.get('categoryId')===(categoryId||null));
 await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();const reply=await response;expect(reply.status()).toBe(200);expect(reply.headers()['cache-control']).toBe('no-store');return reply.json();
}
const financial=(page:Page,kind:string)=>page.locator('[data-financial="'+kind+'"] dd');
const agenda=(page:Page,kind:string)=>page.locator('[data-metric="'+kind+'"] dd');
async function capture(page:Page,info:TestInfo,label:string){
 const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures');await mkdir(directory,{recursive:true});
 const name='service-overview.'+info.project.name+'.'+label+'.running.png';
 const path=resolve(directory,name);await page.screenshot({path,fullPage:true});await info.attach(name,{path,contentType:'image/png'});
 if(label==='known'||label==='partial'){
  for(const [part,target] of [['agenda','.service-overview-main'],['finance','[data-financial="received"]']] as const){
   await page.locator(target).scrollIntoViewIfNeeded();
   const detailName='service-overview.'+info.project.name+'.'+label+'-'+part+'.running.png';
   const detailPath=resolve(directory,detailName);await page.screenshot({path:detailPath,fullPage:true});
   await info.attach(detailName,{path:detailPath,contentType:'image/png'});
  }
  await page.getByRole('heading',{name:'Vis\u00e3o geral dos servi\u00e7os',exact:true}).scrollIntoViewIfNeeded();
 }
 await info.attach(name+'.scope.json',{body:JSON.stringify({scope:'LOCAL_SERVED_DASHBOARD_OWNED_SQL',syntheticHistoricalFinancialPreconditions:true,metaConnected:false,pspConnected:false,production:false}),contentType:'application/json'});
}
async function noOverflow(page:Page){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 if(await page.locator('[data-service-overview]').count()){
  const surface=await page.locator('[data-service-overview]').boundingBox();expect(surface).not.toBeNull();
  expect(surface!.x).toBeGreaterThanOrEqual(0);expect(surface!.x+surface!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const refresh=page.getByRole('button',{name:'Atualizar indicadores',exact:true});await expect(refresh).toBeVisible();
  const bounds=await refresh.boundingBox();expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
 }
}
async function signOut(page:Page){
 const response=page.waitForResponse(value=>matches(value,'/v1/auth/logout')&&value.request().method()==='POST');
 const mobile=page.getByLabel('Navegar no dashboard',{exact:true});
 if(await mobile.isVisible())await mobile.selectOption('logout');else await page.getByRole('button',{name:'Sair',exact:true}).click();
 expect((await response).ok()).toBe(true);await expect(page.getByRole('button',{name:'Entrar',exact:true})).toBeVisible();
}

test('T89 SQL-known service cohort, independent finance and real professional/category filters',async({page,context,request},info)=>{
 const current=await seed(request,'services'),before=await snapshot(request),reads=observe(page);
 await signIn(page,context,current);await expect(page.getByRole('heading',{name:'Visão geral dos serviços',exact:true})).toBeVisible();
 const started=Date.now(),body=await apply(page,current);
 expect(body.timeZone).toBe('America/Sao_Paulo');expect(body.period).toEqual({fromDate:current.fromDate,toDate:current.fromDate,from:current.fromDate+'T03:00:00.000Z',until:'2026-11-20T03:00:00.000Z',bounds:'[from,until)'});
 expect(Date.parse(body.asOf)).toBeGreaterThanOrEqual(started);expect(Date.parse(body.asOf)).toBeLessThanOrEqual(Date.now());
 expect(body.metrics.byStatus).toEqual({pending:0,scheduled:0,in_service:0,completed:1,no_show:1,cancelled:0});
 expect(body.metrics.occupancy.offeredMinutes).toBe(100);expect(body.metrics.occupancy.occupiedMinutes).toBe(50);
 const values=body.metrics.valuesByCurrency[0];expect([values.scheduled.amountCents,values.receivable.amountCents,values.received.amountCents,values.refunds.amountCents]).toEqual([10000,5000,9500,1000]);
 await expect(agenda(page,'confirmed')).toHaveText('2');await expect(agenda(page,'completed')).toHaveText('1');await expect(agenda(page,'no-show')).toHaveText('1');
 await expect(financial(page,'scheduled')).toContainText('R$ 100,00');await expect(financial(page,'receivable')).toContainText('R$ 50,00');
 await expect(financial(page,'received')).toContainText('R$ 95,00');await expect(financial(page,'refunds')).toContainText('R$ 10,00');
 await expect(page.locator('[data-service-occupancy] strong')).toHaveText('50%');await expect(page.locator('[data-service-as-of]')).toContainText('Brasília');
 await expect(page.getByText('Serviços efetivamente pagos no período. Já considera descontos e não inclui taxas adicionais do comprador.',{exact:true})).toBeVisible();
 await noOverflow(page);await capture(page,info,'known');
 const filtered=await apply(page,current,current.fromDate,current.fromDate,current.professionalA,current.categoryA);
 expect(filtered.filters).toEqual({professionalId:current.professionalA,categoryId:current.categoryA});
 expect(filtered.metrics.occupancy.occupancyRate).toBe(.75);expect(filtered.metrics.valuesByCurrency[0].received.amountCents).toBe(4500);
 await expect(agenda(page,'no-show')).toHaveText('0');await expect(financial(page,'received')).toContainText('R$ 45,00');
 const metricCount=reads.filter(value=>value.path===metricPath(current)).length;
 await page.getByLabel('Data inicial',{exact:true}).fill('2026-01-01');await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('até 31 dias');expect(reads.filter(value=>value.path===metricPath(current))).toHaveLength(metricCount);
 expect(reads.filter(value=>commerce(value.path))).toEqual([]);expect(await snapshot(request)).toEqual(before);
 await expect(page.locator('body')).not.toContainText('PRIVATE_METRICS_CONTACT');
});

test('T89 real empty denominator, unknown paid classification and SQL read error stay distinct',async({page,context,request},info)=>{
 const current=await seed(request,'services');await signIn(page,context,current);
 await expect(page.getByRole('heading',{name:'Visão geral dos serviços',exact:true})).toBeVisible();
 const empty=await apply(page,current,current.emptyDate);
 expect(empty.dataStatus).toBe('complete');expect(empty.metrics.occupancy.occupancyRate).toBeNull();
 await expect(page.getByText('Sem movimentação neste período',{exact:true})).toBeVisible();await expect(page.getByText('Não calculável',{exact:true})).toBeVisible();
 await capture(page,info,'empty');const before=await snapshot(request);
 try{
  await control(request,'partial-on');const partialBaseline=await snapshot(request),partial=await apply(page,current);
  expect(partial.dataStatus).toBe('partial');expect(partial.metrics.valuesByCurrency[0].received.amountCents).toBeNull();
  expect(partial.metrics.valuesByCurrency[0].received.knownAmountCents).toBe(9500);
  await expect(financial(page,'received')).toContainText('Não confirmado');await expect(financial(page,'received')).toContainText('Valor conhecido: R$ 95,00');
  await expect(page.getByText('Alguns valores aguardam confirmação. Os valores já conhecidos aparecem identificados.',{exact:true})).toBeVisible();
  expect(await snapshot(request)).toEqual(partialBaseline);await noOverflow(page);await capture(page,info,'partial');
 }finally{await control(request,'partial-off');}
 expect(await snapshot(request)).toEqual(before);
 try{
  await control(request,'sql-failure-on');const failed=page.waitForResponse(value=>matches(value,metricPath(current)));
  await page.getByRole('button',{name:'Atualizar indicadores',exact:true}).click();expect((await failed).status()).toBe(503);
  await expect(page.getByText('Não foi possível carregar os indicadores',{exact:true})).toBeVisible();await expect(page.locator('[data-financial]')).toHaveCount(0);
  await capture(page,info,'unavailable-sql');
 }finally{await control(request,'sql-failure-off');}
 const recovered=page.waitForResponse(value=>matches(value,metricPath(current)));await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();expect((await recovered).status()).toBe(200);
 await expect(financial(page,'received')).toContainText('R$ 95,00');expect(await snapshot(request)).toEqual(before);
});

test('T90 existing product overview keeps canonical money and original rolling requests through real controls',async({page,context,request},info)=>{
 const current=await seed(request,'products'),before=await snapshot(request),reads=observe(page);
 await signIn(page,context,current);await expect(page.getByRole('heading',{name:'Visão Geral',exact:true})).toBeVisible();
 const card=page.locator('.stat-card').filter({has:page.locator('span',{hasText:/^Receita Total$/})});
 await expect(card.locator('.stat-card__value')).toContainText('123,45');await expect(page.locator('[data-service-overview]')).toHaveCount(0);
 const path='/v1/checkout/dashboard/store-overview/'+current.merchant_id;
 const refreshed=page.waitForResponse(value=>matches(value,path));await page.getByRole('button',{name:'Atualizar dados',exact:true}).click();
 const refresh=await refreshed;expect(refresh.status()).toBe(200);const body=await refresh.json();expect(body.revenue).toBe(123.45);expect(body.orders_count).toBe(1);
 const range=page.waitForResponse(value=>matches(value,path)&&new URL(value.url()).searchParams.get('period')==='30d');
 await page.getByRole('tab',{name:'7 dias',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'30 dias',exact:true})).toBeFocused();const period=await range;expect(period.status()).toBe(200);expect((await period.json()).revenue).toBe(123.45);
 await expect(card.locator('.stat-card__value')).toContainText('123,45');expect(reads.filter(value=>value.path.endsWith('/service-metrics'))).toEqual([]);
 expect(new Set(reads.filter(value=>commerce(value.path)).map(value=>value.path))).toEqual(new Set([
 '/v1/checkout/dashboard/overview/'+current.merchant_id,path,'/v1/checkout/dashboard/overview/timeseries/'+current.merchant_id,
 '/v1/checkout/funnel/'+current.merchant_id,'/v1/storefront/funnel/'+current.merchant_id]));
 await noOverflow(page);await capture(page,info,'products');await page.reload();await expect(card.locator('.stat-card__value')).toContainText('123,45');
 expect(await snapshot(request)).toEqual(before);
});

test('T90 real admin, logout/new merchant, Staff and review-required mode never share an overview scope',async({page,context,request,browser},info)=>{
 const admin=await seed(request,'admin'),products=await seed(request,'products'),before=await snapshot(request),reads=observe(page);
 await signIn(page,context,admin);await expect(page.getByRole('heading',{name:'Visão geral dos serviços',exact:true})).toBeVisible();await apply(page,admin);
 await expect(financial(page,'received')).toContainText('R$ 95,00');await signOut(page);const checkpoint=reads.length;
 await signIn(page,context,products);await expect(page.getByRole('heading',{name:'Visão Geral',exact:true})).toBeVisible();
 await expect(page.locator('[data-service-overview],[data-financial]')).toHaveCount(0);
 expect(reads.slice(checkpoint).filter(value=>value.path===metricPath(admin))).toEqual([]);await capture(page,info,'scope-after-logout');
 for(const name of ['staff','review'] as const){
  const isolated=await browser.newContext({viewport:info.project.use.viewport,serviceWorkers:'block'}),tab=await isolated.newPage(),current=await seed(request,name),requests=observe(tab);
  try{
   await signIn(tab,isolated,current,name==='staff'?403:200);
   if(name==='review')await expect(tab.getByText('Confirme a modalidade da empresa',{exact:true})).toBeVisible();
   else await expect(tab.getByRole('button',{name:'Sair',exact:true})).toBeVisible();
   await expect(tab.locator('[data-financial],.stat-card')).toHaveCount(0);
   expect(requests.filter(value=>value.path.endsWith('/service-metrics')||commerce(value.path))).toEqual([]);
  }finally{await isolated.close();}
 }
 expect(await snapshot(request)).toEqual(before);
 const evidence=await request.get('/__service/overview/evidence',{timeout:10000});expect(evidence.status()).toBe(200);
 expect(await evidence.json()).toMatchObject({canonicalAppModule:true,authOverrides:false,repositoryOverrides:false,providerCalls:0,production:false});
});
