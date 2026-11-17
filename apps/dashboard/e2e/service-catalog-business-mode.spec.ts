import {test,expect,type APIRequestContext,type Page,type BrowserContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='http://127.0.0.1:5187';
type Auth={email:string;password:string;access_token:string;merchant_id:string};
const headers=(auth:Auth)=>({authorization:'Bearer '+auth.access_token,'idempotency-key':randomUUID()});

async function enter(page:Page,context:BrowserContext,request:APIRequestContext,mode:'products'|'services'){
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const seeded=await request.post('/__service/catalog-'+mode);expect(seeded.status()).toBe(200);const auth:Auth=await seeded.json();
  const profile=await request.get('/v1/merchants/me',{headers:headers(auth)});expect(profile.status()).toBe(200);expect((await profile.json()).businessMode).toBe(mode);
  await page.goto('/?mode=signin');await page.getByLabel('E-mail',{exact:true}).fill(auth.email);await page.getByLabel('Senha',{exact:true}).fill(auth.password);
  const login=page.waitForResponse(response=>response.url().endsWith('/v1/auth/login')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Entrar',exact:true}).last().click();expect((await login).status()).toBe(201);
  await page.goto('/#catalog');await expect(page.getByRole('heading',{name:mode==='services'?'Serviços':'Produtos',exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:mode==='services'?'Cadastrar serviço':'Novo produto',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:mode==='services'?'Novo serviço':'Novo produto',exact:true})).toBeVisible();
  return auth;
}

async function fill(page:Page,mode:'products'|'services',name:string,sku:string){
  // Existing wrapped labels include prefix/error text in their accessible name.
  await page.getByLabel(/^Nome \*/).fill(name);await page.getByLabel('SKU *',{exact:true}).fill(sku);await page.getByLabel(/^Preço \*/).fill('25,00');
  if(mode==='products')await page.getByLabel(/^Peso/).fill('100');
  else await page.getByLabel(/^Modalidade \*/).selectOption('presencial');
}

async function capture(page:Page,mode:'products'|'services'){
  const artifacts=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/artifacts');await mkdir(artifacts,{recursive:true});
  const top=async()=>{
    await page.locator('.product-detail').evaluate(element=>{for(let parent:HTMLElement|null=element as HTMLElement;parent;parent=parent.parentElement)parent.scrollTop=0;window.scrollTo(0,0);});
    await expect(page.getByRole('heading',{name:mode==='services'?'Novo serviço':'Novo produto',exact:true})).toBeInViewport({ratio:1});
    if(mode==='products')for(const type of ['Físico','Digital','Alimentação'])await expect(page.getByRole('button',{name:type,exact:true})).toBeInViewport({ratio:1});
  };
  await page.evaluate(()=>{const old=document.getElementById('local-fixture-label');old?.remove();const label=document.createElement('p');label.id='local-fixture-label';label.textContent='Aplicação e API locais · Empresa e dados sintéticos';Object.assign(label.style,{position:'fixed',bottom:'8px',left:'8px',margin:'0',padding:'8px 10px',background:'#143d2b',color:'#fff',font:'11px system-ui',zIndex:'1000',borderRadius:'6px',maxWidth:'calc(100vw - 16px)',boxSizing:'border-box'});document.body.append(label);});
  await top();await page.screenshot({path:resolve(artifacts,`catalog-${mode}.running.png`),fullPage:true});
  await page.setViewportSize({width:390,height:844});await top();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:resolve(artifacts,`catalog-${mode}-mobile.running.png`),fullPage:true});await page.setViewportSize({width:1440,height:1000});
}

test('CAT-01 products creation keeps physical/digital/food and the actual API refuses service',async({page,context,request})=>{
  const auth=await enter(page,context,request,'products'),types=page.locator('button[aria-pressed]');
  await expect(types).toHaveText(['Físico','Digital','Alimentação']);
  await types.filter({hasText:'Digital'}).click();await expect(page.getByRole('heading',{name:'Informações do download',exact:true})).toBeVisible();
  await types.filter({hasText:'Alimentação'}).click();await expect(types.filter({hasText:'Alimentação'})).toHaveAttribute('aria-pressed','true');
  await types.filter({hasText:'Físico'}).click();await fill(page,'products','Produto físico local','physical-t98');await capture(page,'products');
  const saving=page.waitForResponse(response=>response.url().endsWith(`/v1/merchants/${auth.merchant_id}/products`)&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Criar produto',exact:true}).click();const saved=await saving;expect(saved.status()).toBe(201);
  expect(saved.request().postDataJSON()).toMatchObject({name:'Produto físico local',type:'physical',variants:[{sku:'physical-t98',basePriceInCents:2500,weightGrams:100}]});
  const created=await saved.json(),stored=await request.get(`/v1/merchants/${auth.merchant_id}/products/${created.id}`,{headers:headers(auth)});expect(stored.status()).toBe(200);expect(await stored.json()).toMatchObject({id:created.id,type:'physical',name:'Produto físico local'});
  const refused=await request.post(`/v1/merchants/${auth.merchant_id}/products`,{headers:headers(auth),data:{name:'Forbidden service',type:'service',variants:[{sku:'forbidden-service-t98',basePriceInCents:1000}]}});
  expect(refused.status()).toBe(409);expect(JSON.stringify(await refused.json())).toContain('catalog_business_mode_conflict');
  await expect(page.getByRole('button',{name:'Novo produto',exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'Novo produto',exact:true}).first().click();
  await expect(page.getByLabel(/^Nome \*/)).toHaveValue('');await expect(page.getByLabel('SKU *',{exact:true})).toHaveValue('');await expect(types.filter({hasText:'Físico'})).toHaveAttribute('aria-pressed','true');
});

test('CAT-02 service creation resets correctly and a stale mode cannot bypass the real guard',async({page,context,request})=>{
  const auth=await enter(page,context,request,'services');await expect(page.locator('button[aria-pressed]')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Agendamento do serviço',exact:true})).toBeVisible();await fill(page,'services','Consulta local','service-t98');await capture(page,'services');
  const saving=page.waitForResponse(response=>response.url().endsWith(`/v1/merchants/${auth.merchant_id}/products`)&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Criar serviço',exact:true}).click();const saved=await saving;expect(saved.status()).toBe(201);
  expect(saved.request().postDataJSON()).toMatchObject({name:'Consulta local',type:'service',metadata:{serviceType:'presencial'},variants:[{sku:'service-t98',basePriceInCents:2500}]});
  const created=await saved.json(),stored=await request.get(`/v1/merchants/${auth.merchant_id}/products/${created.id}`,{headers:headers(auth)});expect(stored.status()).toBe(200);expect(await stored.json()).toMatchObject({id:created.id,type:'service',name:'Consulta local'});
  const refused=await request.post(`/v1/merchants/${auth.merchant_id}/products`,{headers:headers(auth),data:{name:'Forbidden physical',type:'physical',variants:[{sku:'forbidden-physical-t98',basePriceInCents:1000,weightGrams:100}]}});
  expect(refused.status()).toBe(409);expect(JSON.stringify(await refused.json())).toContain('catalog_business_mode_conflict');
  await expect(page.getByRole('button',{name:'Salvar alterações',exact:true})).toBeEnabled();
  await expect(page.locator('.product-detail > [role="alert"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Voltar para Serviços',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cadastrar serviço',exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'Cadastrar serviço',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Novo serviço',exact:true})).toBeVisible();await expect(page.getByLabel(/^Nome \*/)).toHaveValue('');await expect(page.getByLabel('SKU *',{exact:true})).toHaveValue('');await expect(page.locator('button[aria-pressed]')).toHaveCount(0);
  await fill(page,'services','Stale service draft','stale-service-t98');
  const deactivated=await request.put(`/v1/merchants/${auth.merchant_id}/products/${created.id}`,{headers:headers(auth),data:{isActive:false}});expect(deactivated.status()).toBe(200);
  const switched=await request.put('/v1/merchants/me/business-mode',{headers:headers(auth),data:{businessMode:'products',expectedBusinessMode:'services'}});expect(switched.status()).toBe(200);
  const staleSaving=page.waitForResponse(response=>response.url().endsWith(`/v1/merchants/${auth.merchant_id}/products`)&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Criar serviço',exact:true}).click();const stale=await staleSaving;expect(stale.status()).toBe(409);expect(stale.request().postDataJSON().type).toBe('service');expect(JSON.stringify(await stale.json())).toContain('catalog_business_mode_conflict');
  const listed=await request.get(`/v1/merchants/${auth.merchant_id}/products`,{headers:headers(auth)});expect(listed.status()).toBe(200);const catalog=await listed.json();expect(catalog.products.map((item:{id:string;type:string;isActive:boolean})=>({id:item.id,type:item.type,isActive:item.isActive}))).toEqual([{id:created.id,type:'service',isActive:false}]);
  await page.goto(`/#product-detail?productId=${created.id}`);
  const reloadedProfile=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me')&&response.request().method()==='GET');
  await page.reload();const freshProfile=await reloadedProfile;expect(freshProfile.status()).toBe(200);expect((await freshProfile.json()).businessMode).toBe('products');
  await expect(page.getByRole('heading',{name:'Consulta local',exact:true})).toBeVisible();
  await expect(page.getByText('Tipo atual: Serviço.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Salvar alterações',exact:true})).toBeDisabled();await expect(page.getByLabel(/^Nome \*/)).toHaveValue('Consulta local');
  const preserved=await request.get(`/v1/merchants/${auth.merchant_id}/products/${created.id}`,{headers:headers(auth)});expect(await preserved.json()).toMatchObject({id:created.id,type:'service',name:'Consulta local',isActive:false});
  await page.getByRole('button',{name:'Voltar para Produtos',exact:true}).click();await page.getByRole('button',{name:'Novo produto',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Novo produto',exact:true})).toBeVisible();await expect(page.locator('button[aria-pressed]')).toHaveText(['Físico','Digital','Alimentação']);await expect(page.getByLabel(/^Nome \*/)).toHaveValue('');
});
