import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

test('T16',async({page,context,request})=>{
  test.setTimeout(120_000); // Includes one unchanged real60s tenant quota window.
  const origin='http://127.0.0.1:5187';
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const seeded=await request.post('/__service/company-about');expect(seeded.status()).toBe(200);const auth=await seeded.json();
  const headers={authorization:'Bearer '+auth.access_token};
  const reloadCompany=async()=>{
    const quota=await request.get('/v1/merchants/me/store-settings',{headers});expect(quota.status()).toBe(200);
    const remaining=Number(quota.headers()['x-ratelimit-remaining']),reset=Number(quota.headers()['x-ratelimit-reset']);
    expect(Number.isFinite(remaining)).toBe(true);expect(Number.isFinite(reset)).toBe(true);
    // A full dashboard reload makes several authenticated reads. Respect the
    // real fixed window before that gesture, without retrying failed responses.
    if(remaining<20){
      const delay=Math.max(0,reset*1000+50-Date.now());expect(delay).toBeLessThanOrEqual(61_000);
      await page.waitForTimeout(delay);
    }
    await page.reload();
  };
  await page.goto('/?mode=signin');await page.getByLabel('E-mail',{exact:true}).fill(auth.email);await page.getByLabel('Senha',{exact:true}).fill(auth.password);
  const login=page.waitForResponse(response=>response.url().endsWith('/v1/auth/login')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Entrar',exact:true}).last().click();expect((await login).status()).toBe(201);
  await page.goto('/#store-settings');
  const about=page.getByLabel('Sobre a empresa',{exact:true});await expect(about).toHaveValue('Apresentação pública sintética para teste local.');
  await page.getByText('Sobre a empresa',{exact:true}).click();await expect(about).toBeFocused();
  await expect(about).toHaveAttribute('maxlength','1200');
  const hint=page.locator('[id="'+await about.getAttribute('aria-describedby')+'"]');await expect(hint).toContainText('Texto público');
  const button=page.getByRole('button',{name:'Salvar configurações'});
  await about.fill('a'.repeat(1199));await about.pressSequentially('aa');expect((await about.inputValue()).length).toBe(1200);await expect(hint).toContainText('1200/1.200');
  const maxSave=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');
  await button.click();expect((await maxSave).status()).toBe(200);
  await expect(page.getByText('Dados da loja salvos.',{exact:true})).toBeVisible();
  const concurrent=await request.put('/v1/merchants/me/store-settings',{headers,data:{company:{email:'novo-comercial@example.test'}}});expect(concurrent.status()).toBe(200);
  const text='Empresa sintética local. Atendimento comercial e informações públicas revisadas.';
  await about.fill(text);
  const saving=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');
  await button.click();const saved=await saving;expect(saved.status()).toBe(200);expect(saved.request().postDataJSON()).toEqual({company:{description:text}});
  expect((await (await request.get('/v1/merchants/me/store-settings',{headers})).json()).company.email).toBe('novo-comercial@example.test');
  await reloadCompany();await expect(about).toHaveValue(text);await expect(page.getByLabel('E-mail de contato')).toHaveValue('novo-comercial@example.test');
  const artifacts=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/artifacts');await mkdir(artifacts,{recursive:true});
  await page.evaluate(()=>{const badge=document.createElement('p');badge.textContent='Aplicação local · Empresa e dados sintéticos';badge.id='local-fixture-label';Object.assign(badge.style,{position:'fixed',bottom:'8px',right:'8px',margin:'0',padding:'8px 12px',background:'#143d2b',color:'#fff',font:'12px system-ui',zIndex:'1000',borderRadius:'6px'});document.body.append(badge);});
  await page.screenshot({path:resolve(artifacts,'company-about.running.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect(about).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await about.scrollIntoViewIfNeeded();await expect(about).toBeInViewport();
  await page.screenshot({path:resolve(artifacts,'company-about-mobile.running.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await about.fill('');const clearing=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');
  await button.click();expect((await clearing).status()).toBe(200);await reloadCompany();await expect(about).toHaveValue('');
  await about.fill('Rascunho retido após falha local simulada.');
  await page.route('**/v1/merchants/me/store-settings',async route=>route.request().method()==='PUT'?route.fulfill({status:500,contentType:'application/json',body:'{"message":"synthetic_save_failure"}'}):route.continue());
  await button.click();await expect(page.locator('.store-settings-page').getByRole('alert').filter({hasText:'Suas alterações foram mantidas'})).toBeVisible();
  await expect(about).toHaveValue('Rascunho retido após falha local simulada.');
  expect((await (await request.get('/v1/merchants/me/store-settings',{headers})).json()).company.description).toBe('');
  await page.unroute('**/v1/merchants/me/store-settings');
  const retrying=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');
  await button.click();expect((await retrying).status()).toBe(200);await reloadCompany();await expect(about).toHaveValue('Rascunho retido após falha local simulada.');
});
