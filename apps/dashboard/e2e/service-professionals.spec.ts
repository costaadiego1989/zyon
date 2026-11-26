import {test,expect,type Page,type Request,type Response,type BrowserContext,type APIRequestContext,type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='http://127.0.0.1:5187';
type Fixture={fixtureId:string;email:string;password:string;access_token:string;merchant_id:string;mode:'services'|'products';role:'OWNER'|'STAFF';professionalId:string;professionalName:string;professionalVersion:number;productId:string;productName:string;variantId:string;secondProductId:string;secondProductName:string;foreignProfessionalId:string;foreignServiceMerchantId:string;appointmentId:string;paymentId:string};
const matches=(value:{url():string;request():{method():string}},path:string,method='GET')=>{const url=new URL(value.url());return url.origin===origin&&url.pathname===path&&value.request().method()===method;};
function observe(page:Page,paths:string[],method='GET'){
  const starts=new Map<string,Request>(),responses=new Map<string,Response>();
  const onRequest=(value:Request)=>{const url=new URL(value.url());for(const path of paths)if(url.origin===origin&&url.pathname===path&&value.method()===method&&!starts.has(path))starts.set(path,value);};
  const onResponse=(value:Response)=>{for(const path of paths)if(matches(value,path,method)&&!responses.has(path))responses.set(path,value);};
  page.on('request',onRequest);page.on('response',onResponse);
  return{async get(path:string){await(starts.get(path)??page.waitForRequest(value=>new URL(value.url()).pathname===path&&new URL(value.url()).origin===origin&&value.method()===method,{timeout:10000}));return responses.get(path)??await page.waitForResponse(value=>matches(value,path,method),{timeout:10000});},close(){page.off('request',onRequest);page.off('response',onResponse);}};
}
async function setAssociation(dialog:Locator,name:string,selected:boolean){
  const control=dialog.getByRole('switch',{name:'Vincular '+name,exact:true});
  await expect(control).toHaveAttribute('aria-checked',String(!selected));await control.click();await expect(control).toHaveAttribute('aria-checked',String(selected));
}
const base=(f:Fixture)=>`/v1/merchants/${f.merchant_id}/service-professionals`;
const management=(f:Fixture)=>[base(f),`/v1/merchants/${f.merchant_id}/categories`,'/v1/merchants/me/service-business-policy'];
const headers=(f:Fixture)=>({authorization:'Bearer '+f.access_token,'idempotency-key':randomUUID()});
async function snapshot(request:APIRequestContext,f:Fixture){const response=await request.get(`/__service/professionals/${f.fixtureId}/snapshot`);expect(response.status()).toBe(200);return response.json();}
async function enter(page:Page,context:BrowserContext,request:APIRequestContext,scenario:string){
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const created=await request.post('/__service/professionals/'+scenario);expect(created.status()).toBe(200);const f:Fixture=await created.json(),reads:string[]=[];
  page.on('request',value=>{const path=new URL(value.url()).pathname;if(management(f).includes(path))reads.push(path);});
  await page.goto('/e2e/fixtures/service-attendance.html?mode=signin#service-attendance?tab=professionals');
  await page.getByLabel('E-mail',{exact:true}).fill(f.email);await page.getByLabel('Senha',{exact:true}).fill(f.password);
  const profile=observe(page,['/v1/merchants/me']),loaded=observe(page,management(f)),login=page.waitForResponse(value=>matches(value,'/v1/auth/login','POST'));
  try{
    const[result]=await Promise.all([login,page.getByRole('button',{name:'Entrar',exact:true}).last().click()]);expect(result.status()).toBe(201);
    const response=await profile.get('/v1/merchants/me');
    if(f.role==='STAFF'){expect(response.status()).toBe(403);expect(await response.json()).toMatchObject({code:'staff_operation_not_permitted',detail:'staff_operation_not_permitted'});}
    else{expect(response.status()).toBe(200);const raw=await response.json(),me=raw.data??raw;expect(me.id).toBe(f.merchant_id);expect(me.businessMode).toBe(f.mode);expect(String(me.role).toUpperCase()).toBe(f.role);}
    if(f.mode==='services'&&f.role==='OWNER')for(const path of management(f))expect((await loaded.get(path)).status()).toBe(200);
    await expect(page.getByRole('heading',{name:'Atendimento',exact:true})).toBeVisible();
  }finally{profile.close();loaded.close();}
  return{f,reads};
}
async function mutate(page:Page,f:Fixture,path:string,method:string,gesture:()=>Promise<unknown>,status:number){
  const action=observe(page,[path],method),reload=observe(page,management(f));
  try{await gesture();const response=await action.get(path);expect(response.status()).toBe(status);const body=await response.json();if(status<300)for(const name of management(f))expect((await reload.get(name)).status()).toBe(200);return{body,payload:response.request().postDataJSON()};}finally{action.close();reload.close();}
}
async function refresh(page:Page,f:Fixture,reloadDocument=false){
  const paths=[...(reloadDocument?['/v1/merchants/me']:[]),...management(f)],watch=observe(page,paths);
  try{if(reloadDocument)await page.reload();else await page.getByRole('button',{name:'Atualizar',exact:true}).click();for(const path of paths)expect((await watch.get(path)).status()).toBe(200);}finally{watch.close();}
}
const row=(page:Page,id:string)=>page.locator(`[data-professional-id="${id}"]`);
async function capture(page:Page,target:Locator,name:string){
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/artifacts');await mkdir(directory,{recursive:true});
  for(const[suffix,width,height]of [['desktop',1440,1000],['mobile',390,844]]as const){
    await page.setViewportSize({width,height});await target.scrollIntoViewIfNeeded();await target.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));await expect(target).toBeInViewport({ratio:1});
    const hit=await target.evaluate(element=>{const box=element.getBoundingClientRect(),top=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return top===element||Boolean(top&&element.contains(top));});expect(hit).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await expect(page.getByText('LOCAL',{exact:true})).toBeVisible();await expect(page.getByText('LOCAL',{exact:true})).toBeInViewport({ratio:1});
    await page.screenshot({path:resolve(directory,`${name}-${suffix}.running.png`),fullPage:false});
  }
  await page.setViewportSize({width:1440,height:1000});
}

test('T76 OWNER creates and edits the real public professional with validation, links, conflict, tenant denial and focus',async({page,context,request})=>{
  const{f}=await enter(page,context,request,'services-owner'),before=await snapshot(request,f),writes:Request[]=[];
  page.on('request',value=>{if(new URL(value.url()).pathname.startsWith(base(f))&&value.method()!=='GET')writes.push(value);});
  const opener=page.getByRole('button',{name:'Novo profissional',exact:true});await opener.click();const dialog=page.getByRole('dialog',{name:'Novo profissional',exact:true});
  await expect(dialog.getByLabel('Fuso horário',{exact:true})).toHaveCount(0);await expect(dialog.getByText('Horário de Brasília',{exact:true})).toBeVisible();await dialog.getByLabel('Nome público',{exact:true}).fill('   ');await dialog.getByRole('button',{name:'Salvar profissional',exact:true}).click();
  await expect(dialog.getByText('Informe o nome público do profissional.',{exact:true})).toBeVisible();expect(writes).toHaveLength(0);
  await dialog.getByLabel('Nome público',{exact:true}).fill('Beatriz · T76');await dialog.getByLabel('Apresentação pública',{exact:true}).fill('Perfil público local');await dialog.getByLabel('Especialidades',{exact:true}).fill('Consulta\nAcompanhamento');
  await setAssociation(dialog,f.productName,true);await setAssociation(dialog,f.secondProductName,true);
  const published=dialog.getByRole('switch',{name:'Publicado para clientes',exact:true});await expect(published).toHaveAttribute('aria-checked','false');await published.focus();await expect(published).toBeFocused();await page.keyboard.press('Space');await expect(published).toHaveAttribute('aria-checked','true');
  const created=await mutate(page,f,base(f),'POST',()=>dialog.getByRole('button',{name:'Salvar profissional',exact:true}).click(),201);
  expect(created.payload).toEqual({publicName:'Beatriz · T76',publicProfile:{description:'Perfil público local',specialties:['Consulta','Acompanhamento']},timeZone:'America/Sao_Paulo',isActive:true,isPublished:true,productIds:expect.arrayContaining([f.productId,f.secondProductId])});expect(created.payload.productIds).toHaveLength(2);expect(created.body.timeZone).toBe('America/Sao_Paulo');
  await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();await expect(page.getByText('Profissional salvo.',{exact:true})).toBeVisible();const id=created.body.id;await expect(row(page,id)).toContainText('Beatriz · T76');
  await row(page,id).getByRole('button',{name:'Editar Beatriz · T76',exact:true}).click();const editing=page.getByRole('dialog',{name:'Editar profissional',exact:true});await editing.getByLabel('Nome público',{exact:true}).fill('Rascunho local');
  const external=await request.patch(base(f)+'/'+id,{headers:headers(f),data:{expectedVersion:created.body.version,publicName:'Nome externo'}});expect(external.status()).toBe(200);const updated=await external.json();
  const conflict=await mutate(page,f,base(f)+'/'+id,'PATCH',()=>editing.getByRole('button',{name:'Salvar profissional',exact:true}).click(),409);expect(conflict.payload.expectedVersion).toBe(created.body.version);
  await expect(editing.getByText(/Seu rascunho foi preservado/)).toBeVisible();await expect(editing.getByLabel('Nome público',{exact:true})).toHaveValue('Rascunho local');expect((await snapshot(request,f)).professionals.find((p:{id:string})=>p.id===id).public_name).toBe('Nome externo');
  await editing.getByRole('button',{name:'Cancelar',exact:true}).click();await refresh(page,f);await row(page,id).getByRole('button',{name:'Editar Nome externo',exact:true}).click();
  await editing.getByLabel('Nome público',{exact:true}).fill('Beatriz final');await setAssociation(editing,f.productName,false);
  const saved=await mutate(page,f,base(f)+'/'+id,'PATCH',()=>editing.getByRole('button',{name:'Salvar profissional',exact:true}).click(),200);
  expect(saved.payload).toEqual({publicName:'Beatriz final',timeZone:'America/Sao_Paulo',isActive:true,isPublished:true,expectedVersion:updated.version,productIds:[f.secondProductId]});expect(saved.body.timeZone).toBe('America/Sao_Paulo');
  await expect(editing).toHaveCount(0);await expect(row(page,id).getByRole('button',{name:'Editar Beatriz final',exact:true})).toBeFocused();await refresh(page,f,true);
  await row(page,id).getByRole('button',{name:'Editar Beatriz final',exact:true}).click();await expect(editing.getByLabel('Nome público',{exact:true})).toHaveValue('Beatriz final');await expect(editing.getByLabel('Fuso horário',{exact:true})).toHaveCount(0);await expect(editing.getByText('Fuso registrado no perfil, somente para consulta: America/Sao_Paulo. Alterar o perfil não converte horários já cadastrados.',{exact:true})).toBeVisible();await expect(editing.getByRole('switch',{name:'Publicado para clientes',exact:true})).toHaveAttribute('aria-checked','true');
  await capture(page,editing.getByLabel('Nome público',{exact:true}),'profissionais-edicao');await expect(editing.getByRole('switch',{name:'Vincular '+f.productName,exact:true})).toHaveAttribute('aria-checked','false');await expect(editing.getByRole('switch',{name:'Vincular '+f.secondProductName,exact:true})).toHaveAttribute('aria-checked','true');await capture(page,editing.getByRole('group',{name:'Serviços realizados',exact:true}),'profissionais-servicos');await editing.getByRole('button',{name:'Cancelar',exact:true}).click();
  const foreign=await request.patch(base(f)+'/'+f.foreignProfessionalId,{headers:headers(f),data:{expectedVersion:1,publicName:'Tentativa negada'}});expect(foreign.status()).toBe(404);
  const tenant=await request.patch(`/v1/merchants/${f.foreignServiceMerchantId}/service-professionals/${f.foreignProfessionalId}`,{headers:headers(f),data:{expectedVersion:1,publicName:'Tentativa negada'}});expect(tenant.status()).toBe(403);
  const after=await snapshot(request,f);expect(after.users).toEqual(before.users);expect(after.prices).toEqual(before.prices);expect(after.appointments).toEqual(before.appointments);expect(after.payments).toEqual(before.payments);expect(after.rows).toEqual(before.rows);expect(after.exceptions).toEqual(before.exceptions);expect(after.foreignProfessional).toEqual(before.foreignProfessional);expect(after.professionals).toHaveLength(before.professionals.length+1);
  expect(after.professionals.find((p:{id:string})=>p.id===id)).toMatchObject({public_name:'Beatriz final',time_zone:'America/Sao_Paulo',is_active:true,is_published:true,version:saved.body.version});expect(after.links.filter((l:{professional_id:string;is_active:boolean})=>l.professional_id===id&&l.is_active).map((l:{product_id:string})=>l.product_id)).toEqual([f.secondProductId]);expect(writes).toHaveLength(3);
});

test('T76 OWNER deactivates and reactivates without publishing, cancelling confirmed history, changing payment or creating login',async({page,context,request})=>{
  const{f}=await enter(page,context,request,'services-owner'),before=await snapshot(request,f),target=row(page,f.professionalId),path=base(f)+'/'+f.professionalId;
  expect(before.appointments.find((a:{id:string})=>a.id===f.appointmentId)).toMatchObject({professional_id:f.professionalId,operational_status:'scheduled'});expect(before.payments.find((p:{id:string})=>p.id===f.paymentId)).toMatchObject({status:'pending',mode:'at_attendance'});
  await target.getByRole('button',{name:'Desativar '+f.professionalName,exact:true}).click();const confirmation=page.getByRole('dialog',{name:'Desativar profissional?',exact:true});
  await expect(confirmation).toContainText('O profissional deixará de aparecer para novos agendamentos.');await expect(confirmation).toContainText('Os agendamentos já confirmados serão mantidos, assim como o histórico de atendimentos.');await capture(page,confirmation,'profissionais-desativacao');await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();expect(await snapshot(request,f)).toEqual(before);
  await target.getByRole('button',{name:'Desativar '+f.professionalName,exact:true}).click();const deactivated=await mutate(page,f,path+'/deactivate','POST',()=>confirmation.getByRole('button',{name:'Desativar profissional',exact:true}).click(),201);expect(deactivated.payload).toEqual({expectedVersion:f.professionalVersion});expect(deactivated.body).toMatchObject({id:f.professionalId,isActive:false,isPublished:false});
  await expect(target).toContainText('Inativo');await expect(page.getByText('Profissional desativado.',{exact:true})).toBeVisible();await expect(target.getByRole('button',{name:'Editar '+f.professionalName,exact:true})).toBeFocused();await capture(page,target,'profissionais-inativo');const inactive=await snapshot(request,f);expect(inactive.appointments).toEqual(before.appointments);expect(inactive.payments).toEqual(before.payments);expect(inactive.users).toEqual(before.users);expect(inactive.links).toEqual(before.links);expect(inactive.prices).toEqual(before.prices);expect(inactive.rows).toEqual(before.rows);expect(inactive.exceptions).toEqual(before.exceptions);
  const eligible=await request.get(base(f)+`/eligible?productId=${f.productId}&variantId=${f.variantId}`,{headers:headers(f)});expect(eligible.status()).toBe(200);expect((await eligible.json()).items.some((p:{professionalId:string})=>p.professionalId===f.professionalId)).toBe(false);
  await target.getByRole('button',{name:'Editar '+f.professionalName,exact:true}).click();const editing=page.getByRole('dialog',{name:'Editar profissional',exact:true}),reactivate=editing.getByRole('switch',{name:'Reativar profissional',exact:true});await expect(reactivate).toHaveAttribute('aria-checked','false');await reactivate.focus();await expect(reactivate).toBeFocused();await page.keyboard.press('Space');await expect(reactivate).toHaveAttribute('aria-checked','true');await expect(editing.getByRole('switch',{name:'Publicado para clientes',exact:true})).toHaveAttribute('aria-checked','false');
  const result=await mutate(page,f,path,'PATCH',()=>editing.getByRole('button',{name:'Salvar profissional',exact:true}).click(),200);expect(result.payload).toEqual({publicName:f.professionalName,timeZone:'America/Sao_Paulo',isActive:true,isPublished:false,expectedVersion:deactivated.body.version});expect(result.body).toMatchObject({id:f.professionalId,isActive:true,isPublished:false});await expect(target).toContainText('Não publicado');const after=await snapshot(request,f);expect(after.appointments).toEqual(before.appointments);expect(after.payments).toEqual(before.payments);expect(after.users).toEqual(before.users);expect(after.links).toEqual(before.links);expect(after.prices).toEqual(before.prices);
});

for(const scenario of ['products-owner','services-staff'])test(`T76 ${scenario} cannot manage professionals or change owned persistence`,async({page,context,request})=>{
  const{f,reads}=await enter(page,context,request,scenario),before=await snapshot(request,f);await expect(page.getByText('Atendimento indisponível para esta conta',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Novo profissional',exact:true})).toHaveCount(0);expect(reads).toEqual([]);
  const denied=await request.post(base(f),{headers:headers(f),data:{publicName:'Tentativa negada',timeZone:'America/Sao_Paulo'}});expect(denied.status()).toBe(403);expect(await snapshot(request,f)).toEqual(before);expect(reads).toEqual([]);
});
