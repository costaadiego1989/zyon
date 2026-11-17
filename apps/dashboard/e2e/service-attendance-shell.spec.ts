import {test,expect,type Page,type Request,type Response,type BrowserContext,type APIRequestContext,type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='http://127.0.0.1:5187';
type Fixture={fixtureId:string;email:string;password:string;access_token:string;merchant_id:string;mode:'services'|'products';role:'OWNER'|'STAFF';professionalId:string;professionalName:string;professionalVersion:number;categoryId:string;categoryName:string;foreignMerchantId:string};
const matches=(value:{url():string;request():{method():string}},path:string,method='GET')=>{const url=new URL(value.url());return url.origin===origin&&url.pathname===path&&value.request().method()===method;};
const started=(value:Request,path:string)=>{const url=new URL(value.url());return url.origin===origin&&url.pathname===path&&value.method()==='GET';};
function observe(page:Page,paths:string[]){
  const starts=new Map<string,Request>(),responses=new Map<string,Response>();
  const request=(value:Request)=>{for(const path of paths)if(started(value,path)&&!starts.has(path))starts.set(path,value);};
  const response=(value:Response)=>{for(const path of paths)if(matches(value,path)&&!responses.has(path))responses.set(path,value);};
  page.on('request',request);page.on('response',response);
  const result=async(path:string)=>{await(starts.get(path)??page.waitForRequest(value=>started(value,path),{timeout:10000}));return responses.get(path)??await page.waitForResponse(value=>matches(value,path),{timeout:10000});};
  return{async get(path:string){const response=await result(path);expect(response.status()).toBe(200);return response;},async denied(path:string){const response=await result(path);expect(response.status()).toBe(403);const body=await response.json();expect(body.code).toBe('staff_operation_not_permitted');expect(body.detail).toBe('staff_operation_not_permitted');return response;},close(){page.off('request',request);page.off('response',response);}};
}
const management=(fixture:Fixture)=>[`/v1/merchants/${fixture.merchant_id}/service-professionals`,`/v1/merchants/${fixture.merchant_id}/categories`,'/v1/merchants/me/service-business-policy'];
const authHeaders=(fixture:Fixture)=>({authorization:'Bearer '+fixture.access_token,'idempotency-key':randomUUID()});
async function snapshot(request:APIRequestContext,fixture:Fixture){const result=await request.get(`/__service/attendance/${fixture.fixtureId}/snapshot`);expect(result.status()).toBe(200);return result.json();}
async function enter(page:Page,context:BrowserContext,request:APIRequestContext,scenario:string){
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const created=await request.post('/__service/attendance/'+scenario);expect(created.status()).toBe(200);const fixture:Fixture=await created.json();
  const reads:string[]=[];page.on('request',value=>{const path=new URL(value.url()).pathname;if(management(fixture).includes(path))reads.push(path);});
  await page.goto('/e2e/fixtures/service-attendance.html?mode=signin#service-attendance?tab=professionals');
  await page.getByLabel('E-mail',{exact:true}).fill(fixture.email);await page.getByLabel('Senha',{exact:true}).fill(fixture.password);
  const observations=observe(page,['/v1/merchants/me',...management(fixture)]),login=page.waitForResponse(value=>matches(value,'/v1/auth/login','POST'));
  try{
    const[loggedIn]=await Promise.all([login,page.getByRole('button',{name:'Entrar',exact:true}).last().click()]);expect(loggedIn.status()).toBe(201);
    if(fixture.role==='STAFF')await observations.denied('/v1/merchants/me');
    else{const profile=await(await observations.get('/v1/merchants/me')).json(),me=profile.data??profile;
      expect(me.id).toBe(fixture.merchant_id);expect(me.businessMode).toBe(fixture.mode);expect(String(me.role).toUpperCase()).toBe(fixture.role);
    }
    if(fixture.mode==='services'&&fixture.role==='OWNER')await Promise.all(management(fixture).map(path=>observations.get(path)));
    await expect(page.getByRole('heading',{name:'Atendimento',exact:true})).toBeVisible();
  }finally{observations.close();}
  return{fixture,reads};
}
async function capture(page:Page,target:Locator,name:string){
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/artifacts');await mkdir(directory,{recursive:true});
  for(const[suffix,width,height]of [['desktop',1440,1000],['mobile',390,844]]as const){
    await page.setViewportSize({width,height});await target.scrollIntoViewIfNeeded();await target.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));await expect(target).toBeInViewport({ratio:1});
    const hit=await target.evaluate(element=>{const box=element.getBoundingClientRect(),top=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return top===element||Boolean(top&&element.contains(top));});expect(hit).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await expect(page.getByText('Aplicação, API e banco locais · Dados sintéticos · Sem conexão com produção',{exact:true})).toBeInViewport();
    await page.screenshot({path:resolve(directory,`${name}-${suffix}.running.png`),fullPage:false});
  }
  await page.setViewportSize({width:1440,height:1000});
}

test.afterEach(async({page},info)=>{
  if(info.status===info.expectedStatus)return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const result=await Promise.race([page.evaluate(async()=>{
      const boxes=()=>Array.from(document.querySelectorAll('button,[role="tab"],input,select')).slice(-20).map(node=>{const box=node.getBoundingClientRect();return{tag:node.tagName,role:node.getAttribute('role'),text:node.textContent?.trim().slice(0,60),x:box.x,y:box.y,width:box.width,height:box.height};});
      const before=boxes(),start=performance.now();
      const frame=await new Promise(resolve=>{const id=requestAnimationFrame(()=>{clearTimeout(timeout);resolve({advanced:true,elapsedMs:performance.now()-start});});const timeout=setTimeout(()=>{cancelAnimationFrame(id);resolve({advanced:false,elapsedMs:performance.now()-start});},1000);});
      return{visibility:document.visibilityState,focused:document.hasFocus(),active:document.activeElement?.tagName,frame,before,after:boxes()};
    }).catch(()=>({evaluationFailed:true})),new Promise(resolve=>{timer=setTimeout(()=>resolve({evaluationUnavailableWithinMs:3000}),3000);})]);
    await info.attach('bounded-attendance-render-diagnosis',{body:Buffer.from(JSON.stringify(result,null,2)),contentType:'application/json'});
  }finally{if(timer!==undefined)clearTimeout(timer);}
});

test('T75 service OWNER navigates the real read-only shell and reopens the persisted grade',async({page,context,request})=>{
  const{fixture}=await enter(page,context,request,'services-owner'),before=await snapshot(request,fixture);
  const professionalRow=page.getByRole('tabpanel',{name:'Profissionais',exact:true}).getByText(fixture.professionalName,{exact:true});
  await expect(professionalRow).toBeVisible();
  const professionals=page.getByRole('tab',{name:'Profissionais',exact:true});await professionals.focus();await expect(professionals).toBeFocused();
  await capture(page,professionalRow,'atendimento');
  await professionals.focus();await page.keyboard.press('ArrowRight');
  const categories=page.getByRole('tab',{name:'Categorias',exact:true});await expect(categories).toBeFocused();await expect(categories).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tabpanel')).toContainText(fixture.categoryName);
  await page.getByLabel('Categoria',{exact:true}).selectOption(fixture.categoryId);
  await page.getByLabel('De',{exact:true}).fill('2027-01-04');await page.getByLabel('Até',{exact:true}).fill('2027-01-05');await page.getByRole('button',{name:'Aplicar período',exact:true}).click();
  await page.getByRole('tab',{name:'Disponibilidade',exact:true}).click();await page.getByLabel('Profissional',{exact:true}).selectOption(fixture.professionalId);
  const gradePath=`/v1/merchants/${fixture.merchant_id}/service-professionals/${fixture.professionalId}/availability`,observations=observe(page,[gradePath]);
  let grade;
  try{const[result]=await Promise.all([observations.get(gradePath),page.getByRole('button',{name:'Consultar grade',exact:true}).click()]);grade=await result.json();}finally{observations.close();}
  expect(grade).toMatchObject({professionalId:fixture.professionalId,version:fixture.professionalVersion,timeZone:'America/Sao_Paulo',rows:[expect.objectContaining({weekday:1,startMinute:480,endMinute:720})],exceptions:[expect.objectContaining({kind:'block'})]});
  await expect(page.getByRole('tabpanel')).toContainText('08:00–12:00');await expect(page.getByRole('tabpanel')).toContainText('Bloqueio');
  await capture(page,page.getByRole('tabpanel',{name:'Disponibilidade',exact:true}),'atendimento-grade');
  const savedHash=new URL(page.url()).hash;expect(savedHash).toContain('fromDate=2027-01-04');expect(savedHash).toContain('professionalId='+fixture.professionalId);
  const reopen=observe(page,['/v1/merchants/me',...management(fixture)]);
  try{await page.reload();await Promise.all(['/v1/merchants/me',...management(fixture)].map(path=>reopen.get(path)));}finally{reopen.close();}
  await expect(page.getByRole('tab',{name:'Disponibilidade',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByLabel('Profissional',{exact:true})).toHaveValue(fixture.professionalId);await expect(page.getByLabel('De',{exact:true})).toHaveValue('2027-01-04');
  const forbidden=await request.get(`/v1/merchants/${fixture.foreignMerchantId}/service-professionals`,{headers:authHeaders(fixture)});expect(forbidden.status()).toBe(403);
  expect(await snapshot(request,fixture)).toEqual(before);expect(before.professionals).toContainEqual(expect.objectContaining({id:fixture.professionalId,publicName:fixture.professionalName,version:fixture.professionalVersion}));
  expect(before.rows).toContainEqual(expect.objectContaining({professionalId:fixture.professionalId,startMinute:480,endMinute:720}));expect(before.appointments).toBe(0);
});

for(const[scenario,name]of [['products-owner','products'],['services-staff','staff']]as const){
  test(`T75 ${scenario} is denied before management reads and by the actual server`,async({page,context,request})=>{
    const{fixture,reads}=await enter(page,context,request,scenario),before=await snapshot(request,fixture);
    const denial=page.getByText('Atendimento indisponível para esta conta',{exact:true});await expect(denial).toBeVisible();await expect(page.getByRole('tablist')).toHaveCount(0);expect(reads).toEqual([]);
    await expect(page.getByText(fixture.professionalName,{exact:true})).toHaveCount(0);
    const response=await request.post(`/v1/merchants/${fixture.merchant_id}/service-professionals`,{headers:authHeaders(fixture),data:{publicName:'Tentativa sintética negada',timeZone:'America/Sao_Paulo'}});expect(response.status()).toBe(403);
    if(fixture.role==='STAFF'){const policy=await request.get('/v1/merchants/me/service-business-policy',{headers:authHeaders(fixture)});expect(policy.status()).toBe(403);}
    await capture(page,denial,'atendimento-denied-'+name);expect(await snapshot(request,fixture)).toEqual(before);expect(reads).toEqual([]);
  });
}
