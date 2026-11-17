import {test,expect,type Page,type Request,type Response,type BrowserContext,type APIRequestContext,type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='http://127.0.0.1:5187';
type Fixture={fixtureId:string;email:string;password:string;access_token:string;merchant_id:string;mode:'services'|'products';role:'OWNER'|'STAFF';professionalId:string;professionalName:string;secondProfessionalId:string;secondProfessionalName:string;productId:string;productName:string;variantId:string;foreignCategoryId:string;foreignCategoryMerchantId:string};
const matches=(value:{url():string;request():{method():string}},path:string,method='GET')=>{const url=new URL(value.url());return url.origin===origin&&url.pathname===path&&value.request().method()===method;};
function observe(page:Page,paths:string[],method='GET'){
  const starts=new Map<string,Request>(),responses=new Map<string,Response>();
  const onRequest=(value:Request)=>{const url=new URL(value.url());for(const path of paths)if(url.origin===origin&&url.pathname===path&&value.method()===method&&!starts.has(path))starts.set(path,value);};
  const onResponse=(value:Response)=>{for(const path of paths)if(matches(value,path,method)&&!responses.has(path))responses.set(path,value);};
  page.on('request',onRequest);page.on('response',onResponse);
  return{async get(path:string){await(starts.get(path)??page.waitForRequest(value=>new URL(value.url()).pathname===path&&new URL(value.url()).origin===origin&&value.method()===method,{timeout:10000}));return responses.get(path)??await page.waitForResponse(value=>matches(value,path,method),{timeout:10000});},close(){page.off('request',onRequest);page.off('response',onResponse);}};
}
const professionals=(f:Fixture)=>`/v1/merchants/${f.merchant_id}/service-professionals`;
const management=(f:Fixture)=>[professionals(f),`/v1/merchants/${f.merchant_id}/categories`,'/v1/merchants/me/service-business-policy'];
const headers=(f:Fixture)=>({authorization:'Bearer '+f.access_token,'idempotency-key':randomUUID()});
async function snapshot(request:APIRequestContext,f:Fixture){const response=await request.get(`/__service/categories/${f.fixtureId}/snapshot`);expect(response.status()).toBe(200);return response.json();}
async function enter(page:Page,context:BrowserContext,request:APIRequestContext,scenario:string){
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const created=await request.post('/__service/categories/'+scenario);expect(created.status()).toBe(200);const f:Fixture=await created.json(),reads:string[]=[];
  page.on('request',value=>{const path=new URL(value.url()).pathname;if(management(f).includes(path))reads.push(path);});
  await page.goto('/e2e/fixtures/service-attendance.html?mode=signin#service-attendance?tab=categories');
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
  const canonical=[categoryPath(f)],action=observe(page,[path],method),reload=observe(page,canonical);
  try{await gesture();const response=await action.get(path);expect(response.status()).toBe(status);const body=await response.json();if(status<300)for(const name of canonical)expect((await reload.get(name)).status()).toBe(200);return{body,payload:response.request().postDataJSON()};}finally{action.close();reload.close();}
}
async function refresh(page:Page,f:Fixture,reloadDocument=false){
  const paths=[...(reloadDocument?['/v1/merchants/me']:[]),...management(f)],watch=observe(page,paths);
  try{if(reloadDocument)await page.reload();else await page.getByRole('button',{name:'Atualizar',exact:true}).click();for(const path of paths)expect((await watch.get(path)).status()).toBe(200);}finally{watch.close();}
}
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

const categoryPath=(f:Fixture)=>`/v1/merchants/${f.merchant_id}/categories`;
const categoryRow=(page:Page,name:string)=>page.getByRole('button',{name:'Editar '+name,exact:true}).locator('..');
const categorySwitch=(page:Page,name:string)=>categoryRow(page,name).getByRole('switch',{name:'Categoria '+name+' ativa',exact:true});
async function createCategory(page:Page,f:Fixture,name:string,parentId?:string){
  const opener=page.getByRole('button',{name:'Nova categoria',exact:true});await opener.click();const dialog=page.getByRole('dialog',{name:'Nova categoria',exact:true});
  await dialog.getByLabel('Nome da categoria',{exact:true}).fill(name);if(parentId)await dialog.getByLabel('Categoria superior',{exact:true}).selectOption(parentId);
  const result=await mutate(page,f,categoryPath(f),'POST',()=>dialog.getByRole('button',{name:'Criar categoria',exact:true}).click(),201);
  await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();await expect(page.getByText('Categoria salva.',{exact:true})).toBeVisible();return result;
}
async function assign(page:Page,f:Fixture,categoryId:string,status:number){
  const path=`/v1/merchants/${f.merchant_id}/products/${f.productId}`,catalog=`/v1/merchants/${f.merchant_id}/products`;
  const read=observe(page,[path]),write=observe(page,[path],'PUT'),reload=observe(page,[categoryPath(f),catalog]);
  try{
    await page.getByLabel('Categoria de '+f.productName,{exact:true}).selectOption(categoryId);await page.getByRole('button',{name:'Salvar categoria de '+f.productName,exact:true}).click();
    const current=await read.get(path),saved=await write.get(path);expect(current.status()).toBe(200);expect(saved.status()).toBe(status);expect(saved.request().postDataJSON()).toEqual({categoryId});
    expect(current.request().timing().startTime).toBeLessThanOrEqual(saved.request().timing().startTime);
    if(status<300)for(const route of [categoryPath(f),catalog])expect((await reload.get(route)).status()).toBe(200);
    return saved.json();
  }finally{read.close();write.close();reload.close();}
}
function preservedOffer(product:Record<string,unknown>){const copy={...product};delete copy.category_id;delete copy.updated_at;return copy;}

test('T77 OWNER creates edits pauses and deletes categories from the real empty state without changing offers or capacity',async({page,context,request})=>{
  const{f}=await enter(page,context,request,'services-owner'),before=await snapshot(request,f);
  expect(before.categories).toEqual([]);await expect(page.getByText('Nenhuma categoria cadastrada',{exact:true})).toBeVisible();
  await capture(page,page.getByText('Nenhuma categoria cadastrada',{exact:true}),'categorias-vazio');
  const parent=await createCategory(page,f,'Consultas T77');expect(parent.payload).toEqual({name:'Consultas T77',slug:'consultas-t77',description:'',imageUrl:''});
  const child=await createCategory(page,f,'Avaliações T77',parent.body.id);expect(child.payload).toEqual({name:'Avaliações T77',slug:'avaliacoes-t77',parentId:parent.body.id,description:'',imageUrl:''});
  await categoryRow(page,'Avaliações T77').getByRole('button',{name:'Editar Avaliações T77',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Editar categoria',exact:true});
  await dialog.getByLabel('Nome da categoria',{exact:true}).fill('Atendimentos T77');await dialog.getByLabel('Categoria superior',{exact:true}).selectOption('');
  const edited=await mutate(page,f,categoryPath(f)+'/'+child.body.id,'PUT',()=>dialog.getByRole('button',{name:'Salvar categoria',exact:true}).click(),200);
  expect(edited.payload).toEqual({name:'Atendimentos T77',parent_id:null,description:'',imageUrl:''});await expect(dialog).toHaveCount(0);await expect(categoryRow(page,'Atendimentos T77').getByRole('button',{name:'Editar Atendimentos T77',exact:true})).toBeFocused();
  await categoryRow(page,'Atendimentos T77').getByRole('button',{name:'Editar Atendimentos T77',exact:true}).click();await expect(dialog.getByLabel('Categoria superior',{exact:true})).toHaveValue('');await expect(dialog.getByLabel('Identificador no endereço',{exact:true})).toHaveValue('avaliacoes-t77');await capture(page,dialog,'categorias-edicao');await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  const active=categorySwitch(page,'Atendimentos T77');await active.focus();await expect(active).toBeFocused();const paused=await mutate(page,f,categoryPath(f)+'/'+child.body.id,'PUT',()=>page.keyboard.press('Space'),200);expect(paused.payload).toEqual({isActive:false});await expect(active).toHaveAttribute('aria-checked','false');
  const beforeCancel=await snapshot(request,f);await categoryRow(page,'Consultas T77').getByRole('button',{name:'Excluir Consultas T77',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'Excluir categoria',exact:true});await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();expect(await snapshot(request,f)).toEqual(beforeCancel);
  await categoryRow(page,'Consultas T77').getByRole('button',{name:'Excluir Consultas T77',exact:true}).click();await mutate(page,f,categoryPath(f)+'/'+parent.body.id,'DELETE',()=>confirmation.getByRole('button',{name:'Excluir categoria',exact:true}).click(),200);await expect(page.getByRole('button',{name:'Nova categoria',exact:true})).toBeFocused();await expect(page.getByText('Categoria excluída.',{exact:true})).toBeVisible();
  const after=await snapshot(request,f);expect(after.categories).toHaveLength(1);expect(after.categories[0]).toMatchObject({id:child.body.id,name:'Atendimentos T77',parent_id:null,is_active:false});
  for(const key of ['products','variants','prices','professionals','policy','links','rows','exceptions','users','foreignCategory'])expect(after[key]).toEqual(before[key]);
});

test('T77 OWNER reconciles a real missing-category error then shares one persisted offer between two professional filters without extra capacity',async({page,context,request})=>{
  const{f}=await enter(page,context,request,'services-owner'),path=categoryPath(f);
  const create=async(name:string)=>{const response=await request.post(path,{headers:headers(f),data:{name,slug:'t77-'+randomUUID()}});expect(response.status()).toBe(201);return response.json();};
  const obsolete=await create('Destino removido T77'),kept=await create('Vínculo persistente T77');await refresh(page,f);const before=await snapshot(request,f);
  const catalog=`/v1/merchants/${f.merchant_id}/products`,loaded=observe(page,[catalog]);try{await page.getByRole('button',{name:'Consultar serviços publicados',exact:true}).click();expect((await loaded.get(catalog)).status()).toBe(200);}finally{loaded.close();}
  await page.getByLabel('Categoria de '+f.productName,{exact:true}).selectOption(obsolete.id);const removed=await request.delete(path+'/'+obsolete.id,{headers:headers(f)});expect(removed.status()).toBe(200);
  await assign(page,f,obsolete.id,409);await expect(page.getByText('Confira os dados atuais antes de salvar novamente.',{exact:true})).toBeVisible();await expect(page.getByLabel('Categoria de '+f.productName,{exact:true})).toHaveValue(obsolete.id);expect((await snapshot(request,f)).products).toEqual(before.products);
  await capture(page,page.getByText('Confira os dados atuais antes de salvar novamente.',{exact:true}),'categorias-erro');
  const reconcile=observe(page,[categoryPath(f),catalog]);try{await page.getByRole('button',{name:'Atualizar dados e vínculos',exact:true}).click();for(const route of [categoryPath(f),catalog])expect((await reconcile.get(route)).status()).toBe(200);}finally{reconcile.close();}
  const saved=await assign(page,f,kept.id,200);expect(saved).toMatchObject({id:f.productId,categoryId:kept.id});await expect(page.getByText('Vínculo de categoria salvo.',{exact:true})).toBeVisible();await refresh(page,f,true);
  for(const id of [f.professionalId,f.secondProfessionalId]){
    await page.getByLabel('Profissional',{exact:true}).selectOption(id);const read=observe(page,[catalog]);try{await page.getByRole('button',{name:'Consultar serviços publicados',exact:true}).click();const response=await read.get(catalog);expect(response.status()).toBe(200);const body=await response.json();expect(body.products).toHaveLength(1);expect(body.products[0]).toMatchObject({id:f.productId,categoryId:kept.id});}finally{read.close();}
    await expect(page.getByLabel('Categoria de '+f.productName,{exact:true})).toHaveValue(kept.id);
  }
  await capture(page,page.getByLabel('Categoria de '+f.productName,{exact:true}).locator('..'),'categorias-vinculo');
  const foreign=await request.put(`/v1/merchants/${f.foreignCategoryMerchantId}/categories/${f.foreignCategoryId}`,{headers:headers(f),data:{name:'Tentativa negada'}});expect(foreign.status()).toBe(403);
  const invalid=await request.put(`/v1/merchants/${f.merchant_id}/products/${f.productId}`,{headers:headers(f),data:{categoryId:f.foreignCategoryId}});expect(invalid.status()).toBe(409);
  const after=await snapshot(request,f);expect(after.products).toHaveLength(before.products.length);expect(after.products.map(preservedOffer)).toEqual(before.products.map(preservedOffer));expect(after.products[0]).toMatchObject({id:f.productId,category_id:kept.id});
  for(const key of ['variants','prices','professionals','policy','links','rows','exceptions','users','foreignCategory'])expect(after[key]).toEqual(before[key]);
  expect(after.links.filter((link:{product_id:string;is_active:boolean})=>link.product_id===f.productId&&link.is_active).map((link:{professional_id:string})=>link.professional_id).sort()).toEqual([f.professionalId,f.secondProfessionalId].sort());
});

test('T77 product OWNER is denied Atendimento while its existing category API remains available and isolated from services',async({page,context,request})=>{
  const{f,reads}=await enter(page,context,request,'products-owner'),before=await snapshot(request,f);
  await expect(page.getByText('Atendimento indisponível para esta conta',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Nova categoria',exact:true})).toHaveCount(0);expect(reads).toEqual([]);
  const owned=await request.post('/__service/categories/services-owner');expect(owned.status()).toBe(200);const serviceFixture:Fixture=await owned.json(),servicesBefore=await snapshot(request,serviceFixture);
  const response=await request.put(categoryPath(f)+'/'+f.foreignCategoryId,{headers:headers(f),data:{name:'Categoria produtos preservada T77'}});expect(response.status()).toBe(200);
  const denied=await request.post(categoryPath(serviceFixture),{headers:headers(f),data:{name:'Tentativa negada'}});expect(denied.status()).toBe(403);
  const after=await snapshot(request,f);expect(after.categories).toHaveLength(before.categories.length);expect(after.categories.find((row:{id:string})=>row.id===f.foreignCategoryId)).toMatchObject({name:'Categoria produtos preservada T77'});
  for(const key of ['products','variants','prices','professionals','policy','links','rows','exceptions','users'])expect(after[key]).toEqual(before[key]);
  const servicesAfter=await snapshot(request,serviceFixture);for(const key of ['categories','products','variants','prices','professionals','policy','links','rows','exceptions','users'])expect(servicesAfter[key]).toEqual(servicesBefore[key]);
  expect(servicesAfter.foreignCategory).toEqual(after.categories.find((row:{id:string})=>row.id===f.foreignCategoryId));expect(reads).toEqual([]);
});

test('T77 STAFF retains private profile denial and cannot mutate categories or persistence',async({page,context,request})=>{
  const{f,reads}=await enter(page,context,request,'services-staff'),before=await snapshot(request,f);
  await expect(page.getByText('Atendimento indisponível para esta conta',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Nova categoria',exact:true})).toHaveCount(0);expect(reads).toEqual([]);
  const denied=await request.post(categoryPath(f),{headers:headers(f),data:{name:'Tentativa negada'}});expect(denied.status()).toBe(403);expect(await snapshot(request,f)).toEqual(before);expect(reads).toEqual([]);
});
