import {test,expect,type APIRequestContext,type BrowserContext,type Page,type Locator,type Request,type Response} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='http://127.0.0.1:5187';
type Fixture={email:string;password:string;access_token:string;merchant_id:string;productId:string;name:string;sku:string;mode:'products'|'services';plan:'starter'|'growth';fixtureId:string};
type ObservedRequest={method:string;path:string;status:number};
const headers=(fixture:Fixture)=>({authorization:'Bearer '+fixture.access_token,'idempotency-key':randomUUID()});
const pathFor=(fixture:Fixture,suffix:string)=>`/v1/merchants/${fixture.merchant_id}/products/${fixture.productId}/${suffix}`;
const matches=(response:{url():string;request():{method():string}},path:string,method='GET')=>{const url=new URL(response.url());return url.origin===origin&&url.pathname===path&&response.request().method()===method;};
const matchesStart=(request:Request,path:string)=>{const url=new URL(request.url());return url.origin===origin&&url.pathname===path&&request.method()==='GET';};

test.afterEach(async({page},info)=>{
  if(info.status===info.expectedStatus)return;
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
    const diagnosis=await Promise.race([page.evaluate(async()=>{
      const boxes=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).slice(-16).map(button=>{const box=button.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return{text:button.textContent?.trim().slice(0,80),disabled:button.disabled,x:box.x,y:box.y,width:box.width,height:box.height,unobscured:hit===button||Boolean(hit&&button.contains(hit))};});
      const before=boxes(),started=performance.now();
      const frame=await new Promise<{advanced:boolean;elapsedMs:number}>(done=>{
        let frameId=0;const timer=window.setTimeout(()=>{cancelAnimationFrame(frameId);done({advanced:false,elapsedMs:performance.now()-started});},1000);
        frameId=requestAnimationFrame(()=>{clearTimeout(timer);done({advanced:true,elapsedMs:performance.now()-started});});
      });
      return{visibility:document.visibilityState,hasFocus:document.hasFocus(),activeTag:document.activeElement?.tagName,viewport:{width:innerWidth,height:innerHeight},frame,before,after:boxes()};
    }).catch(()=>({evaluationFailed:true})),new Promise(resolve=>{timeout=setTimeout(()=>resolve({evaluationUnavailableWithinMs:3000}),3000);})]);
    await info.attach('bounded-render-diagnosis',{body:Buffer.from(JSON.stringify(diagnosis,null,2)),contentType:'application/json'});
  }finally{if(timeout!==undefined)clearTimeout(timeout);}
});

async function editorAfterBootstrap(page:Page,fixture:Fixture,gesture:()=>Promise<unknown>,signingIn=false){
  let observedProduct:Response|undefined,observedPromotion:Response|undefined;
  let startedProduct:Request|undefined,startedPromotion:Request|undefined;
  const productPath=`/v1/merchants/${fixture.merchant_id}/products/${fixture.productId}`,promotionPath=pathFor(fixture,'promotion');
  // Buffer real starts/responses before the gesture, including fast completions.
  // Cold editor loading precedes the separate existing10s HTTP response phase.
  const collect=(response:Response)=>{if(matches(response,productPath)&&!observedProduct)observedProduct=response;if(matches(response,promotionPath)&&!observedPromotion)observedPromotion=response;};
  const collectStart=(request:Request)=>{if(matchesStart(request,productPath)&&!startedProduct)startedProduct=request;if(matchesStart(request,promotionPath)&&!startedPromotion)startedPromotion=request;};
  page.on('request',collectStart);page.on('response',collect);
  const bootstrap=page.waitForResponse(response=>matches(response,'/v1/onboarding'));
  const login=signingIn?page.waitForResponse(response=>matches(response,'/v1/auth/login','POST')):Promise.resolve(null);
  try{
    const [initialized,loggedIn]=await Promise.all([bootstrap,login,gesture()]);expect(initialized.status()).toBe(200);if(signingIn)expect(loggedIn!.status()).toBe(201);
    await Promise.all([startedProduct??page.waitForRequest(request=>matchesStart(request,productPath)),startedPromotion??page.waitForRequest(request=>matchesStart(request,promotionPath))]);
    const [loaded,promoted]=await Promise.all([observedProduct??page.waitForResponse(response=>matches(response,productPath)),observedPromotion??page.waitForResponse(response=>matches(response,promotionPath))]);
    expect(loaded.status()).toBe(200);expect(promoted.status()).toBe(200);
    await expect(page.getByRole('heading',{name:fixture.name,exact:true})).toBeVisible();
    const disclosure=page.locator('details.product-detail__advanced').filter({has:page.getByText('Promoções e regras do produto',{exact:true})});
    await disclosure.locator('summary').click();await expect(disclosure).toHaveAttribute('open','');
    return disclosure.locator('section').first();
  }finally{page.off('request',collectStart);page.off('response',collect);}
}

async function enter(page:Page,context:BrowserContext,request:APIRequestContext,mode:Fixture['mode'],plan:Fixture['plan']){
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const created=await request.post(`/__service/catalog-entitlements/${mode}/${plan}`);expect(created.status()).toBe(200);const fixture:Fixture=await created.json();
  const billing=await request.get('/v1/billing/subscription',{headers:headers(fixture)});expect(billing.status()).toBe(200);const subscription=await billing.json();
  expect(subscription.plan).toBe(plan);expect(subscription.features.advancedRules).toBe(plan==='growth');
  const observed:ObservedRequest[]=[];
  const started:Array<{method:string;path:string}>=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.origin===origin&&url.pathname.endsWith('/advanced-rules'))started.push({method:request.method(),path:url.pathname});});
  page.on('response',response=>{const url=new URL(response.url());if(url.origin===origin&&url.pathname.endsWith('/advanced-rules'))observed.push({method:response.request().method(),path:url.pathname,status:response.status()});});
  // This current saved-editor route avoids a competing cold overview/catalog
  // import. Authentication and every editor operation still use the real app.
  await page.goto(`/?mode=signin#product-detail?productId=${fixture.productId}`);
  await page.getByLabel('E-mail',{exact:true}).fill(fixture.email);await page.getByLabel('Senha',{exact:true}).fill(fixture.password);
  const section=await editorAfterBootstrap(page,fixture,()=>page.getByRole('button',{name:'Entrar',exact:true}).last().click(),true);
  await expect(section.getByRole('switch').first()).toBeEnabled();
  await section.getByRole('switch').first().click();
  return {fixture,section,observed,started};
}

async function capture(page:Page,target:Locator,name:string){
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/artifacts');await mkdir(directory,{recursive:true});
  await page.evaluate(()=>{const label=document.createElement('p');label.id='t107-local-proof';label.textContent='App, API e banco locais · Dados sintéticos';Object.assign(label.style,{position:'fixed',top:'8px',left:'8px',padding:'8px 10px',margin:'0',background:'#143d2b',color:'#fff',font:'11px system-ui',borderRadius:'6px',zIndex:'1000',maxWidth:'calc(100vw - 16px)',boxSizing:'border-box'});document.getElementById(label.id)?.remove();document.body.append(label);});
  for(const [suffix,width,height]of [['desktop',1440,1000],['mobile',390,844]]as const){
    await page.setViewportSize({width,height});await target.scrollIntoViewIfNeeded();await expect(target).toBeInViewport({ratio:1});
    const hit=await target.evaluate(element=>{const rect=element.getBoundingClientRect(),top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return top===element||Boolean(top&&element.contains(top));});expect(hit).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:resolve(directory,`catalog-entitlements-${name}-${suffix}.running.png`),fullPage:false});
  }
  await page.setViewportSize({width:1440,height:1000});
}
async function dismissSaveNotice(page:Page,text:string){
  const notice=page.getByRole('status').filter({hasText:text});
  await expect(notice).toBeVisible();await notice.getByRole('button',{name:'Fechar aviso',exact:true}).click();await expect(notice).toHaveCount(0);
}
async function snapshot(request:APIRequestContext,fixture:Fixture){
  const response=await request.get(`/__service/catalog-entitlements/${fixture.fixtureId}/snapshot`);expect(response.status()).toBe(200);return response.json();
}
async function reopen(page:Page,fixture:Fixture){
  await editorAfterBootstrap(page,fixture,()=>page.reload());
}

for(const mode of ['products','services']as const){
  test(`CAT-05 Starter ${mode} keeps basic promotions without requesting advanced rules`,async({page,context,request})=>{
    const {fixture,section,observed,started}=await enter(page,context,request,mode,'starter');
    await expect(section.getByText('Disponível no plano Growth+.',{exact:true})).toBeVisible();
    await expect(page.getByText('Não foi possível carregar as regras deste produto',{exact:true})).toHaveCount(0);
    await section.getByPlaceholder('10',{exact:true}).fill('12');
    const pending=page.waitForResponse(response=>matches(response,pathFor(fixture,'promotion'),'POST'));
    const [saved]=await Promise.all([pending,section.getByRole('button',{name:'Salvar promoção',exact:true}).click()]);expect(saved.status()).toBe(201);
    const body=saved.request().postDataJSON();expect(body).toMatchObject({isActive:true,discountType:'percent',discountValue:12});expect(body.startsAt).toEqual(expect.any(String));expect(body.endsAt).toEqual(expect.any(String));
    await expect(section.getByRole('button',{name:'Atualizar promoção',exact:true})).toBeVisible();
    await dismissSaveNotice(page,'Promoção criada');
    const database=await snapshot(request,fixture);expect(database.product).toMatchObject({id:fixture.productId,type:mode==='services'?'service':'physical',name:fixture.name,isActive:true});
    expect(database.promotions).toEqual([expect.objectContaining({productId:fixture.productId,discountType:'percent',discountValue:12,isActive:true})]);expect(database.rules).toEqual([]);
    await capture(page,section.getByText('Disponível no plano Growth+.',{exact:true}),`starter-${mode}`);
    await reopen(page,fixture);await expect(section.getByPlaceholder('10',{exact:true})).toHaveValue('12');
    await expect(page.getByText('Não foi possível carregar as regras deste produto',{exact:true})).toHaveCount(0);expect(started).toEqual([]);expect(observed).toEqual([]);
    const forbidden=await request.get(pathFor(fixture,'advanced-rules'),{headers:headers(fixture)});expect(forbidden.status()).toBe(403);
    expect(await snapshot(request,fixture)).toEqual(database);
  });
}

test('CAT-05 Growth retains actual advanced loading and rule editor persistence',async({page,context,request})=>{
  const {fixture,section,observed}=await enter(page,context,request,'products','growth');
  await expect(section.getByRole('button',{name:'Adicionar regra',exact:true})).toBeEnabled();
  expect(observed).toContainEqual({method:'GET',path:pathFor(fixture,'advanced-rules'),status:200});
  await section.getByRole('button',{name:'Adicionar regra',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Nova regra',exact:true});
  await dialog.getByLabel('Nome',{exact:true}).fill('Desconto local T107');await dialog.getByLabel('Valor da condição 1',{exact:true}).fill('100');await dialog.getByLabel('Desconto (%)',{exact:true}).fill('7');
  const pending=page.waitForResponse(response=>matches(response,pathFor(fixture,'advanced-rules'),'PUT'));
  const [saved]=await Promise.all([pending,dialog.getByRole('button',{name:'Salvar regra',exact:true}).click()]);expect(saved.status()).toBe(200);
  const body=saved.request().postDataJSON();expect(body.productSkus).toEqual([fixture.sku]);expect(body.rules).toEqual([expect.objectContaining({name:'Desconto local T107',conditions:[{field:'cart_total',operator:'>',value:'100'}],action:{type:'offer_discount',params:{percent:7}},enabled:true,priority:1})]);
  await expect(section.getByText('Desconto local T107',{exact:true})).toBeVisible();
  await dismissSaveNotice(page,'Regras avançadas salvas');
  const direct=await request.get(pathFor(fixture,'advanced-rules'),{headers:headers(fixture)});expect(direct.status()).toBe(200);const editable=await direct.json();expect(editable.rules).toEqual([expect.objectContaining({...body.rules[0],productId:fixture.productId})]);
  const database=await snapshot(request,fixture);expect(database.rules).toEqual([expect.objectContaining({...body.rules[0],productId:fixture.productId,conditions:[...body.rules[0].conditions,{field:'product_in_cart',operator:'contains',value:fixture.sku}]})]);
  await capture(page,section.getByText('Desconto local T107',{exact:true}),'growth-products');
  await reopen(page,fixture);await expect(section.getByText('Desconto local T107',{exact:true})).toBeVisible();
  expect(observed.filter(item=>item.method==='GET')).toHaveLength(2);expect(observed.every(item=>item.status===200)).toBe(true);expect(await snapshot(request,fixture)).toEqual(database);
});
