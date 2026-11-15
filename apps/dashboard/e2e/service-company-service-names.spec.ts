import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

test('T97',async({page,context,request})=>{
  test.setTimeout(180_000); // Bounded real tenant quota windows, no retries/reset.
  const origin='http://127.0.0.1:5187';
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const seeded=await request.post('/__service/company-services');expect(seeded.status()).toBe(200);const auth=await seeded.json();
  const headers={authorization:'Bearer '+auth.access_token};
  const current=async()=>{const response=await request.get('/v1/merchants/me/store-settings',{headers});expect(response.status()).toBe(200);return response.json();};
  const reloadCompany=async()=>{
    const quota=await request.get('/v1/merchants/me/store-settings',{headers});expect(quota.status()).toBe(200);
    const remaining=Number(quota.headers()['x-ratelimit-remaining']),reset=Number(quota.headers()['x-ratelimit-reset']);expect(Number.isFinite(remaining)).toBe(true);expect(Number.isFinite(reset)).toBe(true);
    if(remaining<20){const delay=Math.max(0,reset*1000+50-Date.now());expect(delay).toBeLessThanOrEqual(61_000);await page.waitForTimeout(delay);}
    const loaded=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/theme')&&response.request().method()==='GET');
    await page.reload();expect((await loaded).status()).toBe(200);
  };
  await page.goto('/?mode=signin');await page.getByLabel('E-mail',{exact:true}).fill(auth.email);await page.getByLabel('Senha',{exact:true}).fill(auth.password);
  const login=page.waitForResponse(response=>response.url().endsWith('/v1/auth/login')&&response.request().method()==='POST');await page.getByRole('button',{name:'Entrar',exact:true}).last().click();expect((await login).status()).toBe(201);
  // The existing form finishes its real theme read after profile/settings.
  // Await that completion before judging the rendered mode-specific control.
  const loaded=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/theme')&&response.request().method()==='GET');
  await page.goto('/#store-settings');expect((await loaded).status()).toBe(200);
  const group=page.getByRole('group',{name:'Serviços da empresa',exact:true}),draft=group.getByLabel('Novo serviço',{exact:true}),add=group.getByRole('button',{name:'Adicionar serviço',exact:true}),save=page.getByRole('button',{name:'Salvar configurações'});
  await expect(group).toBeVisible();await expect(group.getByLabel('Serviço 1',{exact:true})).toHaveValue('Consulta inicial');
  await draft.fill('  Avaliação pública  ');await add.click();await expect(group.getByLabel('Serviço 2',{exact:true})).toHaveValue('Avaliação pública');await expect(draft).toBeFocused();
  await draft.fill('Retorno');await draft.press('Enter');await expect(group.getByLabel('Serviço 3',{exact:true})).toHaveValue('Retorno');
  await draft.fill(' avaliação pública ');await add.click();await expect(group.getByRole('alert')).toHaveText('Este serviço já está na lista.');await draft.fill('');
  await group.getByLabel('Serviço 1',{exact:true}).fill('Consulta detalhada');
  const saving=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');
  await save.click();const saved=await saving;expect(saved.status()).toBe(200);expect(saved.request().postDataJSON()).toEqual({company:{serviceNames:['Consulta detalhada','Avaliação pública','Retorno']}});
  await expect(page.getByText('Dados da loja salvos.',{exact:true})).toBeVisible();
  const concurrent=await request.put('/v1/merchants/me/store-settings',{headers,data:{company:{email:'concurrent-services@example.test'}}});expect(concurrent.status()).toBe(200);
  await group.getByLabel('Serviço 2',{exact:true}).fill('Avaliação revisada');await group.getByLabel('Serviço 2',{exact:true}).press('Enter');
  const savingAgain=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');await save.click();const savedAgain=await savingAgain;expect(savedAgain.status()).toBe(200);expect(savedAgain.request().postDataJSON()).toEqual({company:{serviceNames:['Consulta detalhada','Avaliação revisada','Retorno']}});
  expect((await current()).company.email).toBe('concurrent-services@example.test');
  await reloadCompany();await expect(group.getByLabel('Serviço 1',{exact:true})).toHaveValue('Consulta detalhada');await expect(group.getByLabel('Serviço 2',{exact:true})).toHaveValue('Avaliação revisada');await expect(group.getByLabel('Serviço 3',{exact:true})).toHaveValue('Retorno');
  const artifacts=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/artifacts');await mkdir(artifacts,{recursive:true});
  await page.evaluate(()=>{const badge=document.createElement('p');badge.textContent='Aplicação local · Empresa e dados sintéticos';badge.id='local-fixture-label';Object.assign(badge.style,{position:'fixed',bottom:'8px',right:'8px',margin:'0',padding:'8px 12px',background:'#143d2b',color:'#fff',font:'12px system-ui',zIndex:'1000',borderRadius:'6px'});document.body.append(badge);});
  await group.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(artifacts,'company-services.running.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await group.scrollIntoViewIfNeeded();await expect(draft).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:resolve(artifacts,'company-services-mobile.running.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  for(const name of ['Retorno','Avaliação revisada','Consulta detalhada'])await group.getByRole('button',{name:'Remover '+name,exact:true}).click();
  await expect(group.getByText('Adicione o primeiro serviço no campo abaixo.')).toBeVisible();await expect(draft).toBeFocused();
  const clearing=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');await save.click();const cleared=await clearing;expect(cleared.status()).toBe(200);expect(cleared.request().postDataJSON()).toEqual({company:{serviceNames:[]}});expect((await current()).company.serviceNames).toEqual([]);
  await draft.fill('Rascunho preservado');await add.click();
  await page.route('**/v1/merchants/me/store-settings',async route=>route.request().method()==='PUT'?route.fulfill({status:500,contentType:'application/json',body:'{"message":"synthetic_save_failure"}'}):route.continue());
  await save.click();await expect(page.locator('.store-settings-page').getByRole('alert').filter({hasText:'Suas alterações foram mantidas'})).toBeVisible();await expect(group.getByLabel('Serviço 1',{exact:true})).toHaveValue('Rascunho preservado');expect((await current()).company.serviceNames).toEqual([]);
  await page.unroute('**/v1/merchants/me/store-settings');const retry=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');await save.click();expect((await retry).status()).toBe(200);expect((await current()).company.serviceNames).toEqual(['Rascunho preservado']);
  const mode=await request.put('/v1/merchants/me/business-mode',{headers,data:{businessMode:'products',expectedBusinessMode:'services'}});expect(mode.status()).toBe(200);
  await reloadCompany();await expect(group).toHaveCount(0);expect(Object.hasOwn((await current()).company,'serviceNames')).toBe(false);
  const publicConfig=await request.get('/v1/storefront/synthetic-services-browser/config');expect(publicConfig.status()).toBe(200);expect(Object.hasOwn((await publicConfig.json()).storeSettings.company,'serviceNames')).toBe(false);
  await page.screenshot({path:resolve(artifacts,'company-services-products.running.png'),fullPage:true});
});
