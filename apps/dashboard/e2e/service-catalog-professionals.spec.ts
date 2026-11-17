import {test,expect,type Page,type Request,type Response,type Locator,type BrowserContext,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {ServiceProfessionalDTO} from '../src/api/endpoints/service-attendance.js';

const origin='http://127.0.0.1:5187';
type Fixture={fixtureId:string;email:string;password:string;access_token:string;merchant_id:string;mode:'services'|'products';role:'OWNER'|'STAFF';professionalId?:string;professionalName?:string;otherProductId?:string;productId?:string;productName?:string;page2Professional?:ServiceProfessionalDTO;orderedProfessionals?:ServiceProfessionalDTO[];retainedProductId?:string;concurrentProductId?:string;foreignProfessionalId?:string};
type SqlProfessional={id:string;version:number;public_name:string;is_active:boolean;is_published:boolean;public_profile:unknown;time_zone:string};
type SqlLink={professional_id:string;product_id:string;is_active:boolean;version:number};
type Snapshot={professionals:SqlProfessional[];links:SqlLink[];products:Array<{id:string;type:string;name:string}>;variants:Array<{id:string;product_id:string;sku:string}>;prices:Array<{id:string;variant_id:string;base_price_in_cents:number;currency:string}>;rows:unknown[];exceptions:unknown[];appointments:unknown[];payments:unknown[];users:unknown[];policy:unknown};
const headers=(f:Fixture)=>({authorization:'Bearer '+f.access_token,'idempotency-key':randomUUID()});
const professionalPath=(f:Fixture)=>`/v1/merchants/${f.merchant_id}/service-professionals`;
const is=(request:Request,path:string,method='GET')=>{const url=new URL(request.url());return url.origin===origin&&url.pathname===path&&request.method()===method;};

/** Observe starts and fast completions before the gesture, using real requests. */
function observe(page:Page,predicate:(request:Request)=>boolean){
  const starts:Request[]=[],responses:Response[]=[];
  const start=(request:Request)=>{if(predicate(request))starts.push(request);};
  const response=(value:Response)=>{if(predicate(value.request()))responses.push(value);};
  page.on('request',start);page.on('response',response);
  return{async get(select:(request:Request)=>boolean=()=>true){
    const request=starts.find(select)??await page.waitForRequest(value=>predicate(value)&&select(value),{timeout:10000});
    return responses.find(value=>value.request()===request)??await page.waitForResponse(value=>value.request()===request,{timeout:10000});
  },close(){page.off('request',start);page.off('response',response);}};
}
async function fixture(request:APIRequestContext,name:string):Promise<Fixture>{const response=await request.post('/__service/catalog-professionals/'+name,{timeout:10000});expect(response.status()).toBe(200);return response.json();}
async function snapshot(request:APIRequestContext,f:Fixture):Promise<Snapshot>{const response=await request.get(`/__service/catalog-professionals/${f.fixtureId}/snapshot`,{timeout:10000});expect(response.status()).toBe(200);return response.json();}
async function directPatch(request:APIRequestContext,f:Fixture,path:string,data:object,expected:number,actor:string){
  const response=await request.patch(path,{headers:headers(f),data,timeout:10000});
  console.log('service_t106_test_http',JSON.stringify({atUtc:new Date().toISOString(),actor,method:'PATCH',path:path.replace(/\/merchants\/[^/]+/g,'/merchants/:owned').replace(/\/service-professionals\/[^/]+/g,'/service-professionals/:owned'),status:response.status(),limit:response.headers()['x-ratelimit-limit'],remaining:response.headers()['x-ratelimit-remaining']}));
  expect(response.status()).toBe(expected);return response;
}
const activeLinks=(value:Snapshot,id:string)=>value.links.filter(link=>link.professional_id===id&&link.is_active).map(link=>link.product_id).sort();
function preservesNonLinks(before:Snapshot,after:Snapshot){for(const key of ['prices','rows','exceptions','appointments','payments','users','policy'] as const)expect(after[key],key).toEqual(before[key]);}
async function safety(page:Page,context:BrowserContext,actor:string){
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  page.on('response',response=>{const url=new URL(response.url());if(url.origin!==origin||!url.pathname.startsWith('/v1/'))return;
    console.log('service_t106_browser_http',JSON.stringify({atUtc:new Date().toISOString(),actor,method:response.request().method(),path:url.pathname.replace(/\/merchants\/(?!me(?:\/|$))[^/]+/g,'/merchants/:owned').replace(/\/service-professionals\/[^/]+/g,'/service-professionals/:owned'),pageLimit:url.searchParams.get('limit'),hasCursor:url.searchParams.has('cursor'),status:response.status(),limit:response.headers()['x-ratelimit-limit'],remaining:response.headers()['x-ratelimit-remaining']}));
  });
}
async function signIn(page:Page,f:Fixture,hash:string){
  await page.goto('/?mode=signin'+hash);await page.getByLabel('E-mail',{exact:true}).fill(f.email);await page.getByLabel('Senha',{exact:true}).fill(f.password);
  const profile=observe(page,value=>is(value,'/v1/merchants/me'));
  const login=page.waitForResponse(value=>is(value.request(),'/v1/auth/login','POST'));
  try{
    const [loggedIn]=await Promise.all([login,page.getByRole('button',{name:'Entrar',exact:true}).last().click()]);expect(loggedIn.status()).toBe(201);
    const loaded=await profile.get();expect(loaded.status()).toBe(f.role==='STAFF'?403:200);const raw=await loaded.json();
    if(f.role==='STAFF')expect(raw).toMatchObject({code:'staff_operation_not_permitted',detail:'staff_operation_not_permitted'});
    else{const me=raw.data??raw;expect(me.id).toBe(f.merchant_id);expect(me.businessMode).toBe(f.mode);expect(me.businessModeSelectionState).toBe('selected');expect(String(me.role).toUpperCase()).toBe(f.role);}
  }finally{profile.close();}
}
async function enterCatalog(page:Page,f:Fixture){
  const products=`/v1/merchants/${f.merchant_id}/products`,categories=`/v1/merchants/${f.merchant_id}/categories`;
  const startup=observe(page,value=>is(value,'/v1/onboarding')||is(value,categories)||(is(value,products)&&new URL(value.url()).searchParams.get('status')==='all'&&new URL(value.url()).searchParams.get('limit')==='20'&&new URL(value.url()).searchParams.get('offset')==='0'));
  try{await signIn(page,f,'#catalog');expect((await startup.get(value=>is(value,'/v1/onboarding'))).status()).toBe(200);const [listed,categorized]=await Promise.all([startup.get(value=>is(value,products)),startup.get(value=>is(value,categories))]);expect(listed.status()).toBe(200);expect(categorized.status()).toBe(200);await expect(page.getByRole('heading',{name:f.mode==='services'?'Serviços':'Produtos',exact:true}).first()).toBeVisible();}
  finally{startup.close();}
}
async function openCreate(page:Page,f:Fixture){
  const editor=observe(page,value=>is(value,`/v1/merchants/${f.merchant_id}/categories`));
  try{await page.getByRole('button',{name:f.mode==='services'?'Cadastrar serviço':'Novo produto',exact:true}).first().click();expect((await editor.get()).status()).toBe(200);await expect(page.getByRole('heading',{name:f.mode==='services'?'Novo serviço':'Novo produto',exact:true})).toBeVisible();}
  finally{editor.close();}
}
const panel=(page:Page)=>page.getByRole('region',{name:'Profissionais deste serviço',exact:true});
const control=(page:Page,name:string)=>panel(page).getByRole('switch',{name:'Vincular '+name,exact:true});
const row=(page:Page,name:string)=>panel(page).locator('li').filter({has:page.getByRole('switch',{name:'Vincular '+name,exact:true})});
async function settledMainSave(page:Page){await expect(page.getByRole('button',{name:'Salvar alterações',exact:true})).toBeEnabled();await expect(page.locator('.product-detail > [role="alert"]')).toHaveCount(0);}
async function enterSaved(page:Page,context:BrowserContext,f:Fixture){
  await safety(page,context,f.role+'-'+f.mode);const reads=observe(page,value=>is(value,professionalPath(f))),product=`/v1/merchants/${f.merchant_id}/products/${f.productId}`,categories=`/v1/merchants/${f.merchant_id}/categories`;
  const startup=observe(page,value=>is(value,'/v1/onboarding')||is(value,product)||is(value,categories));
  try{await signIn(page,f,`#product-detail?productId=${encodeURIComponent(f.productId!)}`);expect((await startup.get(value=>is(value,'/v1/onboarding'))).status()).toBe(200);const [offering,categorized,first]=await Promise.all([startup.get(value=>is(value,product)),startup.get(value=>is(value,categories)),reads.get()]);expect(offering.status()).toBe(200);expect(await offering.json()).toMatchObject({id:f.productId,type:'service'});expect(categorized.status()).toBe(200);expect(first.status()).toBe(200);await expect(page.getByRole('heading',{name:f.productName!,exact:true})).toBeVisible();return{reads,first};}
  catch(error){reads.close();throw error;}
  finally{startup.close();}
}
async function toggle(page:Page,name:string,selected:boolean,keyboard=false){
  const target=control(page,name);await expect(target).toHaveAttribute('aria-checked',String(!selected));
  if(keyboard){await target.focus();await target.press('Tab');await page.keyboard.press('Shift+Tab');await expect(target).toBeFocused();expect(await target.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');await target.press('Space');}
  else await target.click();
  await expect(target).toHaveAttribute('aria-checked',String(selected));
}
async function saveLink(page:Page,f:Fixture,id:string,status=200){
  const watched=observe(page,value=>is(value,professionalPath(f)+'/'+id,'PATCH'));
  try{await panel(page).getByRole('button',{name:'Salvar vínculos',exact:true}).click();const response=await watched.get();expect(response.status()).toBe(status);const body=await response.json();if(status===200)await expect(panel(page).getByRole('button',{name:'Recarregar profissionais',exact:true})).toBeEnabled();return{body,payload:response.request().postDataJSON()};}
  finally{watched.close();}
}
async function capture(page:Page,target:Locator,name:string){
  const directory=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/artifacts');await mkdir(directory,{recursive:true});
  await page.evaluate(()=>{const id='t106-local-proof';document.getElementById(id)?.remove();const label=document.createElement('p');label.id=id;label.textContent='App, API e banco locais · Dados sintéticos';Object.assign(label.style,{position:'fixed',bottom:'8px',left:'8px',margin:'0',padding:'8px 10px',background:'#143d2b',color:'#fff',font:'11px system-ui',borderRadius:'6px',zIndex:'1000',maxWidth:'calc(100vw - 16px)',boxSizing:'border-box'});document.body.append(label);});
  for(const [suffix,width,height]of [['desktop',1440,1000],['mobile',390,844]]as const){
    await page.setViewportSize({width,height});await target.scrollIntoViewIfNeeded();await target.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));await expect(target).toBeInViewport({ratio:1});
    const hit=await target.evaluate(element=>{const box=element.getBoundingClientRect(),top=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return top===element||Boolean(top&&element.contains(top));});expect(hit).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await expect(page.locator('#t106-local-proof')).toBeInViewport({ratio:1});await page.screenshot({path:resolve(directory,`service-links-${name}-${suffix}.running.png`),fullPage:false});
  }
  await page.setViewportSize({width:1440,height:1000});
}

test('create once then link, update, reopen and unlink the saved service CAT-04',async({page,context,request})=>{
  const f=await fixture(request,'create'),before=await snapshot(request,f),creates:Request[]=[],professionalReads:Request[]=[];
  await safety(page,context,'create-owner');page.on('request',value=>{if(is(value,`/v1/merchants/${f.merchant_id}/products`,'POST'))creates.push(value);});
  page.on('request',value=>{if(is(value,professionalPath(f)))professionalReads.push(value);});
  await enterCatalog(page,f);await openCreate(page,f);
  await expect(page.getByRole('heading',{name:'Novo serviço',exact:true})).toBeVisible();await expect(panel(page)).toContainText('Salve o serviço para vincular profissionais.');
  expect(professionalReads).toEqual([]);
  await page.getByLabel(/^Nome \*/).fill('Consulta com profissional T106');await page.getByLabel('SKU *',{exact:true}).fill('service-links-t106');await page.getByLabel(/^Preço \*/).fill('25,00');await page.getByLabel(/^Modalidade \*/).selectOption('presencial');
  const created=observe(page,value=>is(value,`/v1/merchants/${f.merchant_id}/products`,'POST')),loaded=observe(page,value=>is(value,professionalPath(f)));
  let product:{id:string;variants:Array<{id:string}>},initial:ServiceProfessionalDTO;
  try{await page.getByRole('button',{name:'Criar serviço',exact:true}).click();const response=await created.get();expect(response.status()).toBe(201);product=await response.json();expect(response.request().postDataJSON()).toMatchObject({name:'Consulta com profissional T106',type:'service',variants:[{sku:'service-links-t106',basePriceInCents:2500}]});await settledMainSave(page);const linked=await loaded.get();expect(linked.status()).toBe(200);initial=(await linked.json()).items.find((p:ServiceProfessionalDTO)=>p.id===f.professionalId);expect(initial).toBeTruthy();}
  finally{created.close();loaded.close();}
  expect(creates).toHaveLength(1);await expect(page).toHaveURL(new RegExp('productId='+product!.id));await expect(control(page,f.professionalName!)).toHaveAttribute('aria-checked','false');const createdSnapshot=await snapshot(request,f);
  await toggle(page,f.professionalName!,true,true);const linked=await saveLink(page,f,f.professionalId!);expect(linked.payload).toEqual({expectedVersion:initial!.version,productIds:[f.otherProductId,product!.id]});await expect(row(page,f.professionalName!)).toContainText('Vínculo salvo.');await expect(row(page,f.professionalName!)).toContainText('Não publicado');
  await capture(page,panel(page),'saved');const afterLink=await snapshot(request,f);expect(activeLinks(afterLink,f.professionalId!)).toEqual([f.otherProductId!,product!.id].sort());preservesNonLinks(createdSnapshot,afterLink);expect(afterLink.professionals).toHaveLength(before.professionals.length);
  const updating=observe(page,value=>is(value,`/v1/merchants/${f.merchant_id}/products/${product!.id}/variants`,'PUT'));
  try{await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();expect((await updating.get()).status()).toBe(200);await settledMainSave(page);}finally{updating.close();}
  expect(creates).toHaveLength(1);const saved=await snapshot(request,f);expect(saved.products.filter(p=>p.id===product!.id)).toHaveLength(1);expect(saved.products.find(p=>p.id===product!.id)).toMatchObject({type:'service',name:'Consulta com profissional T106'});expect(saved.variants.filter(v=>v.product_id===product!.id).map(v=>({id:v.id,sku:v.sku}))).toEqual([{id:product!.variants[0].id,sku:'service-links-t106'}]);expect(saved.prices.filter(p=>p.variant_id===product!.variants[0].id).map(p=>({basePriceInCents:p.base_price_in_cents,currency:p.currency}))).toEqual([{basePriceInCents:2500,currency:'BRL'}]);
  const reload=observe(page,value=>is(value,professionalPath(f)));
  let current:ServiceProfessionalDTO;
  try{await page.reload();const response=await reload.get();expect(response.status()).toBe(200);current=(await response.json()).items.find((p:ServiceProfessionalDTO)=>p.id===f.professionalId);await expect(control(page,f.professionalName!)).toHaveAttribute('aria-checked','true');}finally{reload.close();}
  await toggle(page,f.professionalName!,false);const unlinked=await saveLink(page,f,f.professionalId!);expect(unlinked.payload).toEqual({expectedVersion:current!.version,productIds:[f.otherProductId]});await expect(row(page,f.professionalName!)).toContainText('Sem vínculo com este serviço');
  const final=await snapshot(request,f);expect(activeLinks(final,f.professionalId!)).toEqual([f.otherProductId]);expect(final.professionals.find(p=>p.id===f.professionalId)).toMatchObject({version:unlinked.body.version,is_active:true,is_published:false});preservesNonLinks(saved,final);expect(final.prices.filter(p=>p.variant_id!==product!.variants[0].id)).toEqual(before.prices);expect(creates).toHaveLength(1);
});

test('a real second page links its professional without replacing the other service CAT-04',async({page,context,request})=>{
  const f=await fixture(request,'pagination'),before=await snapshot(request,f),opened=await enterSaved(page,context,f);
  try{const first=await opened.first.json();expect(first.items).toHaveLength(25);expect(first.nextCursor).toBeTruthy();const second=await opened.reads.get(value=>new URL(value.url()).searchParams.get('cursor')===first.nextCursor);expect(second.status()).toBe(200);const body=await second.json();expect(body.items.map((p:ServiceProfessionalDTO)=>p.id)).toEqual([f.page2Professional!.id]);expect(body.nextCursor).toBeNull();}
  finally{opened.reads.close();}
  await expect(panel(page).getByRole('switch')).toHaveCount(26);await toggle(page,f.page2Professional!.publicName,true);
  const result=await saveLink(page,f,f.page2Professional!.id);expect(result.payload).toEqual({expectedVersion:f.page2Professional!.version,productIds:[f.otherProductId,f.productId]});await expect(row(page,f.page2Professional!.publicName)).toContainText('Vínculo salvo.');
  await capture(page,row(page,f.page2Professional!.publicName),'page2');const after=await snapshot(request,f);expect(activeLinks(after,f.page2Professional!.id)).toEqual([f.otherProductId!,f.productId!].sort());preservesNonLinks(before,after);expect(after.professionals).toHaveLength(26);
});

test('partial success stops at a real version conflict and requires reload then confirmation CAT-04',async({page,context,request})=>{
  const f=await fixture(request,'partial'),before=await snapshot(request,f),opened=await enterSaved(page,context,f);opened.reads.close();const [first,second,third]=f.orderedProfessionals!;
  const writes:Request[]=[];page.on('request',value=>{if(value.method()==='PATCH'&&new URL(value.url()).pathname.startsWith(professionalPath(f)+'/'))writes.push(value);});
  for(const item of [first,second,third])await toggle(page,item.publicName,true);
  const concurrent=await directPatch(request,f,professionalPath(f)+'/'+second.id,{expectedVersion:second.version,productIds:[f.concurrentProductId]},200,'concurrent-owner:partial');const changed:ServiceProfessionalDTO=await concurrent.json();
  const batch=observe(page,value=>value.method()==='PATCH'&&new URL(value.url()).pathname.startsWith(professionalPath(f)+'/'));
  try{await panel(page).getByRole('button',{name:'Salvar vínculos',exact:true}).click();const one=await batch.get(value=>is(value,professionalPath(f)+'/'+first.id,'PATCH')),two=await batch.get(value=>is(value,professionalPath(f)+'/'+second.id,'PATCH'));expect(one.status()).toBe(200);expect(two.status()).toBe(409);expect(await two.json()).toMatchObject({code:'service_professional_stale',detail:'service_professional_stale'});expect(one.request().postDataJSON()).toEqual({expectedVersion:first.version,productIds:[f.retainedProductId,f.productId]});expect(two.request().postDataJSON()).toEqual({expectedVersion:second.version,productIds:[f.retainedProductId,f.productId]});}
  finally{batch.close();}
  await expect(row(page,first.publicName)).toContainText('Vínculo salvo.');await expect(row(page,second.publicName)).toContainText('Este profissional mudou.');await expect(row(page,third.publicName)).toContainText('Alteração ainda não salva');await expect(panel(page).getByRole('button',{name:'Salvar vínculos',exact:true})).toBeDisabled();
  const partial=await snapshot(request,f);expect(activeLinks(partial,first.id)).toEqual([f.retainedProductId!,f.productId!].sort());expect(activeLinks(partial,second.id)).toEqual([f.concurrentProductId]);expect(partial.professionals.find(p=>p.id===third.id)).toEqual(before.professionals.find(p=>p.id===third.id));expect(writes.map(value=>new URL(value.url()).pathname)).toEqual([professionalPath(f)+'/'+first.id,professionalPath(f)+'/'+second.id]);await capture(page,panel(page),'conflict');
  const reread=observe(page,value=>is(value,professionalPath(f)));
  try{await panel(page).getByRole('button',{name:'Recarregar profissionais',exact:true}).click();expect((await reread.get()).status()).toBe(200);}finally{reread.close();}
  for(const item of [first,second,third])await expect(control(page,item.publicName)).toHaveAttribute('aria-checked','true');expect(writes).toHaveLength(2);
  const recovery=observe(page,value=>value.method()==='PATCH'&&new URL(value.url()).pathname.startsWith(professionalPath(f)+'/'));
  try{await panel(page).getByRole('button',{name:'Salvar vínculos',exact:true}).click();const two=await recovery.get(value=>is(value,professionalPath(f)+'/'+second.id,'PATCH')),three=await recovery.get(value=>is(value,professionalPath(f)+'/'+third.id,'PATCH'));expect(two.status()).toBe(200);expect(three.status()).toBe(200);expect(two.request().postDataJSON()).toEqual({expectedVersion:changed.version,productIds:[f.concurrentProductId,f.productId]});expect(three.request().postDataJSON()).toEqual({expectedVersion:third.version,productIds:[f.retainedProductId,f.productId]});}
  finally{recovery.close();}
  await expect(row(page,second.publicName)).toContainText('Vínculo salvo.');await expect(row(page,third.publicName)).toContainText('Vínculo salvo.');await expect(panel(page).getByRole('button',{name:'Recarregar profissionais',exact:true})).toBeEnabled();await expect(panel(page).getByRole('button',{name:'Salvar vínculos',exact:true})).toBeDisabled();expect(writes.map(value=>new URL(value.url()).pathname)).toEqual([first.id,second.id,second.id,third.id].map(id=>professionalPath(f)+'/'+id));await capture(page,panel(page),'recovered');
  const after=await snapshot(request,f);expect(activeLinks(after,first.id)).toEqual([f.retainedProductId!,f.productId!].sort());expect(activeLinks(after,second.id)).toEqual([f.concurrentProductId!,f.productId!].sort());expect(activeLinks(after,third.id)).toEqual([f.retainedProductId!,f.productId!].sort());preservesNonLinks(before,after);
});

test('products, actual Staff and a foreign professional cannot use the association writer CAT-04',async({page,context,request,browser})=>{
  const products=await fixture(request,'products'),owner=await fixture(request,'create'),partial=await fixture(request,'partial'),staff=await fixture(request,'staff');
  await safety(page,context,'products-owner');const professionalReads:Request[]=[];page.on('request',value=>{if(new URL(value.url()).pathname.includes('/service-professionals'))professionalReads.push(value);});
  await enterCatalog(page,products);await openCreate(page,products);await page.getByLabel(/^Nome \*/).fill('Produto preservado T106');await page.getByLabel('SKU *',{exact:true}).fill('physical-t106');await page.getByLabel(/^Preço \*/).fill('25,00');await page.getByLabel(/^Peso/).fill('100');
  const creating=observe(page,value=>is(value,`/v1/merchants/${products.merchant_id}/products`,'POST'));
  try{await page.getByRole('button',{name:'Criar produto',exact:true}).click();expect((await creating.get()).status()).toBe(201);await expect(page.getByRole('heading',{name:'Produtos',exact:true}).first()).toBeVisible();}finally{creating.close();}
  await expect(panel(page)).toHaveCount(0);expect(professionalReads).toEqual([]);
  const ownBefore=await snapshot(request,owner),foreignBefore=await snapshot(request,partial),productsBefore=await snapshot(request,products);
  const version=foreignBefore.professionals.find(p=>p.id===owner.foreignProfessionalId)!.version;
  await directPatch(request,products,professionalPath(products)+'/'+owner.professionalId,{expectedVersion:1,productIds:[]},403,'denied-products-owner');
  const foreign=await directPatch(request,owner,professionalPath(owner)+'/'+owner.foreignProfessionalId,{expectedVersion:version,productIds:[]},404,'owner-own-path-foreign-resource');expect(await foreign.json()).toMatchObject({code:'service_professional_not_found',detail:'service_professional_not_found'});
  const staffContext=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000},serviceWorkers:'block'});
  staffContext.setDefaultTimeout(10000);staffContext.setDefaultNavigationTimeout(30000);
  try{const staffPage=await staffContext.newPage(),reads:Request[]=[];await safety(staffPage,staffContext,'staff-partial');staffPage.on('request',value=>{if(new URL(value.url()).pathname.includes('/service-professionals'))reads.push(value);});await signIn(staffPage,staff,`#product-detail?productId=${staff.productId}`);await expect(panel(staffPage)).toHaveCount(0);await expect(staffPage.getByRole('button',{name:'Salvar vínculos',exact:true})).toHaveCount(0);expect(reads).toEqual([]);await directPatch(request,staff,professionalPath(staff)+'/'+staff.professionalId,{expectedVersion:version,productIds:[]},403,'denied-staff:partial');expect(reads).toEqual([]);}
  finally{await staffContext.close();}
  expect(await snapshot(request,owner)).toEqual(ownBefore);expect(await snapshot(request,partial)).toEqual(foreignBefore);expect(await snapshot(request,products)).toEqual(productsBefore);
});
