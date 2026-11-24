import {test,expect,type APIRequestContext,type BrowserContext,type Page,type Locator,type Request,type Response} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='http://127.0.0.1:5187';
type Auth={email:string;password:string;access_token:string;merchant_id:string};
const headers=(auth:Auth)=>({authorization:'Bearer '+auth.access_token,'idempotency-key':randomUUID()});

// UNAPPLIED cache candidate: fixes only the previously proven catalog/editor
// request-phase sequencing. It does not claim to repair the later blank load.
function observeRead(page:Page,predicate:(request:Request)=>boolean){
  let started:Request|undefined,loaded:Response|undefined;
  const collectStart=(request:Request)=>{if(predicate(request))started??=request;};
  const collectResponse=(response:Response)=>{if(predicate(response.request()))loaded??=response;};
  page.on('request',collectStart);page.on('response',collectResponse);
  return{start:()=>started??page.waitForRequest(predicate),response:()=>loaded??page.waitForResponse(response=>predicate(response.request())),stop:()=>{page.off('request',collectStart);page.off('response',collectResponse);}};
}
async function enter(page:Page,context:BrowserContext,request:APIRequestContext,mode:'products'|'services'){
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  page.on('response',response=>{const url=new URL(response.url());if(url.origin===origin&&url.pathname.endsWith('/advanced-rules'))console.log('T105 existing rules diagnostic',JSON.stringify({path:url.pathname,method:response.request().method(),status:response.status(),mode}));});
  const seeded=await request.post('/__service/catalog-'+mode);expect(seeded.status()).toBe(200);const auth:Auth=await seeded.json();
  const profile=await request.get('/v1/merchants/me',{headers:headers(auth)});expect(profile.status()).toBe(200);expect((await profile.json()).businessMode).toBe(mode);
  const isCategory=(request:Request)=>{const url=new URL(request.url());return url.origin===origin&&url.pathname===`/v1/merchants/${auth.merchant_id}/categories`&&request.method()==='GET';};
  const catalog=observeRead(page,request=>{const url=new URL(request.url());return url.origin===origin&&url.pathname===`/v1/merchants/${auth.merchant_id}/products`&&url.searchParams.get('status')==='all'&&url.searchParams.get('limit')==='20'&&url.searchParams.get('offset')==='0'&&request.method()==='GET';});
  const categories=observeRead(page,isCategory);
  try{
    await page.goto('/?mode=signin#catalog');await page.getByLabel('E-mail',{exact:true}).fill(auth.email);await page.getByLabel('Senha',{exact:true}).fill(auth.password);
    const login=page.waitForResponse(response=>response.url().endsWith('/v1/auth/login')&&response.request().method()==='POST');
    const session=page.waitForResponse(response=>new URL(response.url()).origin===origin&&new URL(response.url()).pathname==='/v1/onboarding'&&response.request().method()==='GET');
    const [loggedIn,initialized]=await Promise.all([login,session,page.getByRole('button',{name:'Entrar',exact:true}).last().click()]);expect(loggedIn.status()).toBe(201);expect(initialized.status()).toBe(200);
    await Promise.all([catalog.start(),categories.start()]);
    const [listed,categorized]=await Promise.all([catalog.response(),categories.response()]);expect(listed.status()).toBe(200);expect(categorized.status()).toBe(200);
    await page.getByRole('navigation',{name:'Módulos do painel',exact:true}).getByRole('button',{name:'Produtos',exact:true}).click();
    await catalogReady(page,mode);
  }finally{catalog.stop();categories.stop();}
  const create=page.getByRole('button',{name:mode==='services'?'Cadastrar serviço':'Novo produto',exact:true}).first();await expect(create).toBeVisible();await expect(create).toBeEnabled();
  const editor=observeRead(page,isCategory);
  try{
    await Promise.all([editor.start(),create.click()]);const editorReady=await editor.response();expect(editorReady.status()).toBe(200);
    await expect(page.getByRole('heading',{name:mode==='services'?'Novo serviço':'Novo produto',exact:true})).toBeVisible();
  }finally{editor.stop();}
  return auth;
}

async function basic(page:Page,name:string,sku:string){
  await page.getByLabel(/^Nome \*/).fill(name);await page.getByLabel('SKU *',{exact:true}).fill(sku);await page.getByLabel(/^Preço \*/).fill('25,00');
}
async function catalogReady(page:Page,mode:'products'|'services'){
  await expect(page.getByRole('heading',{name:mode==='services'?'Serviços':'Produtos',exact:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Todos',exact:true})).toHaveAttribute('aria-pressed','true');
}
async function returnServiceToCatalog(page:Page,mode:'products'|'services'){
  if(mode!=='services')return;
  await expect(page.getByRole('button',{name:'Salvar alterações',exact:true})).toBeEnabled();
  await expect(page.locator('.product-detail > [role="alert"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Voltar para Serviços',exact:true}).click();
}
async function saveNew(page:Page,auth:Auth,mode:'products'|'services'){
  const pending=page.waitForResponse(response=>response.url().endsWith(`/v1/merchants/${auth.merchant_id}/products`)&&response.request().method()==='POST');
  const [saved]=await Promise.all([pending,page.getByRole('button',{name:mode==='services'?'Criar serviço':'Criar produto',exact:true}).click()]);expect(saved.status()).toBe(201);await returnServiceToCatalog(page,mode);await catalogReady(page,mode);return {product:await saved.json(),body:saved.request().postDataJSON()};
}
async function saveExisting(page:Page,auth:Auth,id:string,mode:'products'|'services'){
  const pending=page.waitForResponse(response=>response.url().endsWith(`/v1/merchants/${auth.merchant_id}/products/${id}/variants`)&&response.request().method()==='PUT');
  const [saved]=await Promise.all([pending,page.getByRole('button',{name:'Salvar alterações',exact:true}).click()]);expect(saved.status()).toBe(200);await returnServiceToCatalog(page,mode);await catalogReady(page,mode);return saved.request().postDataJSON();
}
async function read(request:APIRequestContext,auth:Auth,id:string){
  const response=await request.get(`/v1/merchants/${auth.merchant_id}/products/${id}`,{headers:headers(auth)});expect(response.status()).toBe(200);return response.json();
}
async function open(page:Page,auth:Auth,id:string,name:string){
  const edit=page.getByRole('button',{name:`Editar ${name}`,exact:true});await expect(edit).toBeVisible();
  const reading=page.waitForResponse(response=>new URL(response.url()).origin===origin&&new URL(response.url()).pathname===`/v1/merchants/${auth.merchant_id}/products/${id}`&&response.request().method()==='GET');
  const [loaded]=await Promise.all([reading,edit.click()]);expect(loaded.status()).toBe(200);expect((await loaded.json()).id).toBe(id);
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
}
async function keyboardToggle(control:Locator,value:boolean){
  await control.focus();await control.press('Tab');await control.page().keyboard.press('Shift+Tab');await expect(control).toBeFocused();
  expect(await control.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
  await control.press('Space');await expect(control).toHaveAttribute('aria-checked',String(value));
}
async function capture(page:Page,target:Locator,name:string){
  const artifacts=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/artifacts');await mkdir(artifacts,{recursive:true});
  await page.evaluate(()=>{const old=document.getElementById('local-t105-label');old?.remove();const label=document.createElement('p');label.id='local-t105-label';label.textContent='App, API e banco locais · Dados sintéticos';Object.assign(label.style,{position:'fixed',bottom:'8px',left:'8px',margin:'0',padding:'8px 10px',background:'#143d2b',color:'#fff',font:'11px system-ui',zIndex:'1000',borderRadius:'6px',maxWidth:'calc(100vw - 16px)',boxSizing:'border-box'});document.body.append(label);});
  for(const [suffix,width,height]of [['desktop',1440,1000],['mobile',390,844]]as const){
    await page.setViewportSize({width,height});await target.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));await target.scrollIntoViewIfNeeded();await expect(target).toBeInViewport({ratio:1});
    const layout=await target.evaluate(async element=>{
      const label=Array.from(document.querySelectorAll<HTMLLabelElement>('label[for]')).find(item=>item.htmlFor===element.id);
      const box=(item:Element)=>{const r=item.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
      await new Promise<void>(done=>requestAnimationFrame(()=>done()));const first={control:box(element),label:label?box(label):null};
      await new Promise<void>(done=>requestAnimationFrame(()=>done()));const second={control:box(element),label:label?box(label):null};
      const unobscured=(item:Element)=>{const r=item.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===item||Boolean(hit&&item.contains(hit));};
      return{first,second,controlUnobscured:unobscured(element),labelUnobscured:Boolean(label&&unobscured(label))};
    });
    expect(layout.second).toEqual(layout.first);expect(layout.second.label).not.toBeNull();expect(layout.controlUnobscured).toBe(true);expect(layout.labelUnobscured).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:resolve(artifacts,`catalog-toggles-${name}-${suffix}.running.png`),fullPage:false});
  }
  await page.setViewportSize({width:1440,height:1000});
}

test('CAT-03 product Active and food Required switches persist the existing values',async({page,context,request})=>{
  const auth=await enter(page,context,request,'products');await page.getByRole('button',{name:'Alimentação',exact:true}).click();
  await basic(page,'Alimentação local T105','food-t105');await page.getByRole('button',{name:/^Nova categoria/}).click();
  await page.getByPlaceholder('Ex: Bordas, Recheio, Massa').fill('Bordas');await page.getByPlaceholder('Ex: Calabresa, Mussarela').fill('Tradicional');
  const required=page.getByRole('switch',{name:'Obrigatório em Bordas',exact:true});await expect(required).toHaveAttribute('aria-checked','false');await keyboardToggle(required,true);
  const created=await saveNew(page,auth,'products');expect(created.body).toMatchObject({type:'food',metadata:{optionGroups:[{name:'Bordas',required:true,minSelections:1,items:[{name:'Tradicional',priceModifierInCents:0}]}]}});
  await open(page,auth,created.product.id,'Alimentação local T105');await expect(required).toHaveAttribute('aria-checked','true');
  const active=page.getByRole('switch',{name:'Ativo',exact:true});await expect(active).toHaveAttribute('aria-checked','true');await keyboardToggle(active,false);
  await capture(page,active,'active');await capture(page,required,'food');
  const body=await saveExisting(page,auth,created.product.id,'products');expect(body.product.isActive).toBe(false);expect(body.product.metadata.optionGroups).toEqual(created.body.metadata.optionGroups);
  expect(await read(request,auth,created.product.id)).toMatchObject({isActive:false,type:'food',metadata:{optionGroups:created.body.metadata.optionGroups}});
  await open(page,auth,created.product.id,'Alimentação local T105');await expect(active).toHaveAttribute('aria-checked','false');
  await required.click();await expect(required).toHaveAttribute('aria-checked','false');await saveExisting(page,auth,created.product.id,'products');
  const stored=await read(request,auth,created.product.id);expect(stored.isActive).toBe(false);expect(stored.metadata.optionGroups).toEqual(created.body.metadata.optionGroups.map((group:Record<string,unknown>)=>({...group,required:false,minSelections:0})));
  await open(page,auth,created.product.id,'Alimentação local T105');await expect(required).toHaveAttribute('aria-checked','false');await expect(active).toHaveAttribute('aria-checked','false');
});

test('CAT-03 service duration persists while its grade is delegated to Atendimento',async({page,context,request})=>{
  const auth=await enter(page,context,request,'services');await basic(page,'Serviço local T105','service-t105');await page.getByLabel(/^Modalidade \*/).selectOption('presencial');
  await expect(page.getByRole('switch',{name:'Exigir escolha de data e horário',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Adicionar horário',exact:true})).toHaveCount(0);
  const duration=page.getByLabel('Duração em minutos',{exact:true});await duration.fill('45');
  const created=await saveNew(page,auth,'services');expect(created.body).toMatchObject({type:'service',metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:45,slots:[]}}});
  await open(page,auth,created.product.id,'Serviço local T105');await expect(duration).toHaveValue('45');await expect(page.getByRole('link',{name:'Gerenciar horários no Atendimento',exact:true})).toHaveAttribute('href','#service-attendance?tab=availability');await capture(page,duration,'service');
  const before=await read(request,auth,created.product.id);expect(before.metadata).toEqual(created.body.metadata);
  await duration.fill('60');const body=await saveExisting(page,auth,created.product.id,'services');expect(body.product.metadata).toEqual({serviceType:'presencial',serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:60,slots:[]}});
  const stored=await read(request,auth,created.product.id);expect(stored).toMatchObject({id:created.product.id,type:'service',isActive:true});expect(stored.metadata).toEqual(body.product.metadata);
  await open(page,auth,created.product.id,'Serviço local T105');await expect(duration).toHaveValue('60');await expect(page.getByLabel(/^Modalidade \*/)).toHaveValue('presencial');
});
