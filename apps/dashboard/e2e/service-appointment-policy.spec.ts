import {test,expect,type Page,type Request,type Response,type APIRequestContext} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='http://127.0.0.1:5187',policyPath='/v1/merchants/me/service-business-policy';
type Fixture={fixtureId:string;email:string;password:string;access_token:string;merchant_id:string;mode:'services';role:'OWNER'};
type Policy={status:'configured';version:number;policy:{paymentMode:'online'|'at_attendance';holdEnabled:boolean;holdMinutes:number|null;admissionsEnabled:boolean}};
type Snapshot={policy:{paymentMode:string;holdEnabled:boolean;holdMinutes:number|null;admissionsEnabled:boolean;version:number};appointments:number;[key:string]:unknown};
const matches=(response:Response,path:string,method='GET')=>new URL(response.url()).origin===origin&&new URL(response.url()).pathname===path&&response.request().method()===method;
const isWrite=(request:Request)=>new URL(request.url()).origin===origin&&new URL(request.url()).pathname===policyPath&&request.method()==='PUT';
const headers=(f:Fixture)=>({authorization:'Bearer '+f.access_token,'idempotency-key':randomUUID()});
async function fixture(request:APIRequestContext){
  const response=await request.post('/__service/attendance/services-owner',{headers:{'x-service-local-run-id':process.env.SERVICE_LOCAL_RUN_ID??'',
    'x-service-local-attendance-purpose':'policy-local','x-service-local-attendance-case':createHash('sha256').update(test.info().testId).digest('hex')}});expect(response.status()).toBe(200);
  const f:Fixture=await response.json();expect(f.mode).toBe('services');expect(f.role).toBe('OWNER');return f;
}
async function readPolicy(request:APIRequestContext,f:Fixture):Promise<Policy>{
  const response=await request.get(policyPath,{headers:headers(f),timeout:10000});expect(response.status()).toBe(200);
  const value:Policy=await response.json();expect(value.status).toBe('configured');expect(value.version).toBeGreaterThan(0);return value;
}
async function writePolicy(request:APIRequestContext,f:Fixture,previous:Policy,input:Policy['policy']):Promise<Policy>{
  const response=await request.put(policyPath,{headers:headers(f),data:{expectedVersion:previous.version,...input},timeout:10000});
  expect(response.status()).toBe(200);const saved:Policy=await response.json();expect(saved).toMatchObject({status:'configured',version:previous.version+1,policy:input});return saved;
}
async function snapshot(request:APIRequestContext,f:Fixture):Promise<Snapshot>{
  const response=await request.get(`/__service/attendance/${f.fixtureId}/snapshot`);expect(response.status()).toBe(200);return response.json();
}
function unchangedExceptPolicy(before:Snapshot,after:Snapshot){
  const {policy:oldPolicy,...oldFacts}=before,{policy:newPolicy,...newFacts}=after;
  expect(newFacts).toEqual(oldFacts);expect(after.appointments).toBe(before.appointments);
}
async function enter(page:Page,f:Fixture){
  await page.goto('/e2e/fixtures/service-attendance.html?mode=signin#service-attendance?tab=settings');
  await page.getByLabel('E-mail',{exact:true}).fill(f.email);await page.getByLabel('Senha',{exact:true}).fill(f.password);
  const login=page.waitForResponse(response=>matches(response,'/v1/auth/login','POST'));
  const policy=page.waitForResponse(response=>matches(response,policyPath));
  await page.getByRole('button',{name:'Entrar',exact:true}).last().click();expect((await login).status()).toBe(201);expect((await policy).status()).toBe(200);
  await expect(page.getByRole('heading',{name:'Atendimento',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'Configurações',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('switch',{name:'Cobrança online',exact:true})).toBeVisible();
}
async function assertControls(page:Page,value:Policy['policy']){
  await expect(page.getByRole('switch',{name:'Cobrança online',exact:true})).toHaveAttribute('aria-checked',String(value.paymentMode==='online'));
  await expect(page.getByLabel('Reserva temporária',{exact:true})).toHaveValue(value.holdEnabled?'on':'off');
  if(value.holdEnabled)await expect(page.getByLabel('Duração da reserva (minutos)',{exact:true})).toHaveValue(String(value.holdMinutes));
  else await expect(page.getByLabel('Duração da reserva (minutos)',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('switch',{name:'Aceitar novos agendamentos',exact:true})).toHaveAttribute('aria-checked',String(value.admissionsEnabled));
}
async function reload(page:Page){
  const policy=page.waitForResponse(response=>matches(response,policyPath));await page.reload();expect((await policy).status()).toBe(200);
  await expect(page.getByRole('switch',{name:'Cobrança online',exact:true})).toBeVisible();
}
async function capture(page:Page,name:string){
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');await mkdir(directory,{recursive:true});
  for(const [suffix,width,height]of [['desktop',1440,1000],['mobile',390,844]]as const){
    await page.setViewportSize({width,height});
    const target=page.locator('.appointment-policy');await target.scrollIntoViewIfNeeded();
    await page.getByRole('switch',{name:'Cobrança online',exact:true}).scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:resolve(directory,`t81-policy-${name}-${suffix}.running.png`),fullPage:false});
    if(suffix==='mobile'){
      await page.getByRole('button',{name:'Salvar política',exact:true}).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button',{name:'Salvar política',exact:true})).toBeInViewport();
      await page.screenshot({path:resolve(directory,`t81-policy-${name}-mobile-actions.running.png`),fullPage:false});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
}
test.beforeEach(async({context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
});

for(const online of [false,true])for(const hold of [false,true]){
  test(`T81 real owner saves ${online?'online':'at-attendance'} / hold ${hold?'on':'off'} through gestures and reloads the exact SQL policy`,async({page,request})=>{
    const f=await fixture(request),current=await readPolicy(request,f);
    const prior=await writePolicy(request,f,current,{paymentMode:online?'at_attendance':'online',holdEnabled:!hold,holdMinutes:hold?null:7,admissionsEnabled:true});
    const before=await snapshot(request,f);await enter(page,f);await assertControls(page,prior.policy);
    await page.getByRole('switch',{name:'Cobrança online',exact:true}).click();
    await page.getByLabel('Reserva temporária',{exact:true}).selectOption(hold?'on':'off');
    if(hold)await page.getByLabel('Duração da reserva (minutos)',{exact:true}).fill('4');
    const wanted:Policy['policy']={paymentMode:online?'online':'at_attendance',holdEnabled:hold,holdMinutes:hold?4:null,admissionsEnabled:true};
    await assertControls(page,wanted);
    const response=page.waitForResponse(value=>matches(value,policyPath,'PUT'));await page.getByRole('button',{name:'Salvar política',exact:true}).click();
    const saved=await response;expect(saved.status()).toBe(200);expect(saved.request().postDataJSON()).toEqual({expectedVersion:prior.version,...wanted});
    expect(await saved.json()).toMatchObject({status:'configured',version:prior.version+1,policy:wanted});
    await expect(page.getByText('Configuração salva.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Salvar política',exact:true})).toBeDisabled();
    const after=await snapshot(request,f);expect(after.policy).toEqual({...wanted,version:prior.version+1});unchangedExceptPolicy(before,after);
    await reload(page);await assertControls(page,wanted);await expect(page.getByRole('button',{name:'Salvar política',exact:true})).toBeDisabled();
    expect(await snapshot(request,f)).toEqual(after);await capture(page,`${online?'online':'local'}-${hold?'held':'unheld'}`);
  });
}

test('T81 real concurrent policy version rejects the stale form, preserves its draft and rereads without automatic resubmission',async({page,request})=>{
  const f=await fixture(request),current=await readPolicy(request,f);
  const prior=await writePolicy(request,f,current,{paymentMode:'at_attendance',holdEnabled:false,holdMinutes:null,admissionsEnabled:true});
  await enter(page,f);await page.getByRole('switch',{name:'Cobrança online',exact:true}).click();
  const newer=await writePolicy(request,f,prior,{paymentMode:'at_attendance',holdEnabled:true,holdMinutes:9,admissionsEnabled:false});
  const before=await snapshot(request,f),writes:Request[]=[];const observe=(value:Request)=>{if(isWrite(value))writes.push(value);};page.on('request',observe);
  try{
    const rejected=page.waitForResponse(value=>matches(value,policyPath,'PUT'));await page.getByRole('button',{name:'Salvar política',exact:true}).click();
    const response=await rejected;expect(response.status()).toBe(409);expect(response.request().postDataJSON()).toEqual({expectedVersion:prior.version,paymentMode:'online',holdEnabled:false,holdMinutes:null,admissionsEnabled:true});
    await expect(page.getByRole('switch',{name:'Cobrança online',exact:true})).toHaveAttribute('aria-checked','true');
    await expect(page.getByLabel('Reserva temporária',{exact:true})).toHaveValue('off');
    await expect(page.getByRole('button',{name:'Salvar política',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Recarregar política',exact:true})).toBeEnabled();
    expect(writes).toHaveLength(1);expect(await snapshot(request,f)).toEqual(before);await capture(page,'version-conflict');
    const refreshed=page.waitForResponse(value=>matches(value,policyPath));await page.getByRole('button',{name:'Recarregar política',exact:true}).click();expect((await refreshed).status()).toBe(200);
    await assertControls(page,newer.policy);await expect(page.getByRole('button',{name:'Salvar política',exact:true})).toBeDisabled();
    expect(writes).toHaveLength(1);expect(await snapshot(request,f)).toEqual(before);
  }finally{page.off('request',observe);}
});
