import {test,expect,type APIRequestContext,type BrowserContext,type Page,type Locator,type Response} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const origin='http://127.0.0.1:5187';
export const localLabel='Aplicação, API e banco locais · Dados sintéticos · Sem conexão com produção';
export interface JourneyFixture {fixtureId:string;runId:string;email:string;password:string;access_token:string;merchant_id:string;user_id:string;mode:'services'|'products';role:'OWNER'|'STAFF';storeName:string;productId:string;productName:string;variantId:string;professionalId:string;professionalName:string;professionalVersion:number;categoryId:string;policyVersion:number;baseDate:string;toDate:string;operationsDate:string;manualDate:string;knownCustomerId:string;foreignCustomerId:string;foreignMerchantId:string;childStoreId:string;childStoreName:string;appointments:Record<string,string>}
export interface JourneySnapshot {runId:string;professionals:any[];exceptions:any[];appointments:any[];payments:any[];audits:any[];receipts:any[];events:any[];stock:any[]}
const fixtureHeaders=()=>({'x-service-local-run-id':process.env.SERVICE_LOCAL_RUN_ID??''});
export async function fixture(request:APIRequestContext,name:string):Promise<JourneyFixture>{
  const manifest=await request.get('/__service/manifest');expect(manifest.status()).toBe(200);const owned=await manifest.json();expect(owned.kind).toBe('local-owned');expect(owned.origin).toBe(origin);expect(owned.runId).toBe(process.env.SERVICE_LOCAL_RUN_ID);
  const info=test.info(),manualLocal=name==='local'&&basename(info.file)==='service-manual-booking.spec.ts';
  const operationsLocal=name==='local'&&basename(info.file)==='service-appointment-operations.spec.ts';
  const routesFile=basename(info.file)==='service-appointments-routes.spec.ts';
  const routesLocal=routesFile&&name==='local'&&info.title==='T83 real Back/refresh and authorized store activation fence the previous merchant service surface';
  const routesStaff=routesFile&&name==='staff'&&info.title==='T83 actual Staff profile403 never becomes a forged management profile or private booking read';
  const boardLocal=name==='local'&&basename(info.file)==='service-appointments-board.spec.ts'&&["ATEND-11 six persisted states and separate finance share exact canonical IDs/counts in Kanban and list", "ATEND-11 period/professional/service/category/status gestures use the same server selector after refresh", "ATEND-11 mobile keyboard detail and a real stale command preserve prior version/finance until explicit reload"].includes(info.title);
  const boardNavigationLocal=name==='local'&&basename(info.file)==='service-appointments-navigation.spec.ts';
  // Both pagination cases keep the original32; board/non-pagination owners are private per case.
  const purpose=manualLocal?'manual-local':operationsLocal?'operations-local':routesLocal?'routes-local':routesStaff?'routes-staff':boardLocal?'board-local':boardNavigationLocal?'board-navigation-local':undefined;
  const caseHeaders:Record<string,string>=purpose?{'x-service-local-journey-purpose':purpose,'x-service-local-journey-case':createHash('sha256').update(info.testId).digest('hex')}:{};
  const reply=await request.get('/__service/appointment-journeys/'+name,{headers:{...fixtureHeaders(),...caseHeaders}});expect(reply.status()).toBe(200);const value=await reply.json();expect(value.runId).toBe(owned.runId);return value;
}
export async function snapshot(request:APIRequestContext,seed:JourneyFixture):Promise<JourneySnapshot>{const reply=await request.get(`/__service/appointment-journeys/${seed.fixtureId}/snapshot`,{headers:fixtureHeaders()});expect(reply.status()).toBe(200);const value=await reply.json();expect(value.runId).toBe(seed.runId);return value;}
export const matches=(response:Response,path:string,method='GET')=>new URL(response.url()).origin===origin&&new URL(response.url()).pathname===path&&response.request().method()===method;
export const prefix=(seed:JourneyFixture)=>`/v1/merchants/${seed.merchant_id}/service-appointments`;
export async function api(request:APIRequestContext,seed:JourneyFixture,path:string,method='GET',body?:unknown,expected=method==='POST'?201:200){const reply=await request.fetch('/v1'+path,{method,timeout:10000,headers:{authorization:'Bearer '+seed.access_token,...(body?{'idempotency-key':(body as any).commandId??randomUUID()}:{} )},...(body?{data:body}:{})});expect(reply.status()).toBe(expected);return reply.json();}
export async function protect(context:BrowserContext,page:Page){
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  await page.addInitScript(label=>{addEventListener('DOMContentLoaded',()=>{const badge=document.createElement('aside');badge.dataset.ownedLocalJourney='true';badge.textContent=label;Object.assign(badge.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'2000',padding:'4px 10px',background:'#143d2b',color:'#fff',font:'11px/16px system-ui',textAlign:'center',pointerEvents:'none'});document.body.append(badge);});},localLabel);
}
export function hash(seed:JourneyFixture){return `#service-appointments?fromDate=${seed.baseDate}&toDate=${seed.toDate}`;}
export async function login(page:Page,seed:JourneyFixture,route=hash(seed),expectedProfile=200){
  await page.goto('/?mode=signin'+route);await page.getByLabel('E-mail',{exact:true}).fill(seed.email);await page.getByLabel('Senha',{exact:true}).fill(seed.password);
  const logged=page.waitForResponse(value=>matches(value,'/v1/auth/login','POST')),profile=page.waitForResponse(value=>matches(value,'/v1/merchants/me'));
  await page.getByRole('button',{name:'Entrar',exact:true}).last().click();expect((await logged).status()).toBe(201);
  const reply=await profile;expect(reply.status()).toBe(expectedProfile);const raw=await reply.json();
  if(expectedProfile===200){const value=raw.data??raw;expect(value.id).toBe(seed.merchant_id);expect(value.businessMode).toBe(seed.mode);expect(String(value.role).toUpperCase()).toBe(seed.role);}else expect(raw.code).toBe('staff_operation_not_permitted');
}
export async function manual(page:Page,seed:JourneyFixture,known=false,oneOff=false){
  await page.getByRole('button',{name:'Novo agendamento',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Novo agendamento',exact:true});await expect(dialog).toBeVisible();
  if(known){await dialog.getByLabel('Tipo de cliente',{exact:true}).selectOption('known');const read=page.waitForResponse(value=>matches(value,'/v1/customers'));await dialog.getByRole('button',{name:'Consultar clientes',exact:true}).click();const response=await read;expect(response.status()).toBe(200);expect(new URL(response.url()).searchParams.get('merchantId')).toBe(seed.merchant_id);await dialog.getByLabel('Cliente cadastrado',{exact:true}).selectOption(seed.knownCustomerId);}
  else{await dialog.getByLabel('Nome do contato',{exact:true}).fill('Cliente manual local');await dialog.getByLabel('Telefone',{exact:true}).fill('21999990000');}
  await dialog.getByLabel('Serviço',{exact:true}).selectOption(seed.productId);await dialog.getByLabel('Profissional',{exact:true}).selectOption(seed.professionalId);
  if(oneOff){await dialog.getByRole('switch',{name:'Informar horário avulso',exact:true}).click();await dialog.getByLabel('Data e hora em Brasília',{exact:true}).fill(seed.manualDate+'T20:30');}
  else{await dialog.getByLabel('Consultar a partir de',{exact:true}).fill(seed.manualDate);await dialog.getByLabel('Consultar até',{exact:true}).fill(seed.manualDate);await dialog.getByRole('button',{name:'Consultar datas',exact:true}).click();await dialog.getByLabel('Data disponível',{exact:true}).selectOption(seed.manualDate);const slots=dialog.getByLabel('Horário disponível',{exact:true});await expect(slots).toBeEnabled();const first=await slots.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value).find(Boolean));expect(first).toBeTruthy();await slots.selectOption(first!);}
  return dialog;
}
export async function openDetail(page:Page,id:string){const record=page.locator(`[data-appointment-id="${id}"]`).first();await expect(record).toBeVisible();await record.click();const dialog=page.getByRole('dialog',{name:'Detalhes do agendamento',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading',{name:'Pagamento',exact:true})).toBeVisible();return dialog;}
export function scoped(before:JourneySnapshot,id:string){const paymentIds=before.payments.filter(row=>row.appointmentId===id).map(row=>row.id);return{appointment:before.appointments.find(row=>row.id===id),payments:before.payments.filter(row=>row.appointmentId===id),audits:before.audits.filter(row=>row.appointmentId===id),receipts:before.receipts.filter(row=>paymentIds.includes(row.paymentId)),events:before.events.filter(row=>row.appointmentId===id),stock:before.stock};}
export async function capture(page:Page,anchor:Locator,name:string){const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts');await mkdir(directory,{recursive:true});for(const [suffix,width,height]of [['desktop',1440,1000],['mobile',390,844]]as const){await page.setViewportSize({width,height});await anchor.scrollIntoViewIfNeeded();await anchor.evaluate(element=>element.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'}));await expect(anchor).toBeInViewport();await expect(page.getByText(localLabel,{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:resolve(directory,`${name}-${suffix}.running.png`),fullPage:false});}await page.setViewportSize({width:1440,height:1000});}
