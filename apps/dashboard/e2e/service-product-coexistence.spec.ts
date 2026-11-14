import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

test('T10',async({browser,request})=>{
  const captures=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures');
  await mkdir(captures,{recursive:true});
  for(const mode of ['products','services'] as const){
    const context=await browser.newContext({baseURL:'http://127.0.0.1:5187',viewport:{width:1280,height:900}});
    try{
      await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5187'?route.continue():route.abort('blockedbyclient'));
      const page=await context.newPage();
      const person=async()=>{
        await page.getByLabel('Nome completo').fill('Pessoa Sintética');
        await page.getByLabel('Cargo / papel na empresa').selectOption('owner');
        await page.getByRole('button',{name:'Continuar',exact:true}).click();
      };
      await page.goto('/?mode=signup');await person();
      await expect(page.getByRole('group',{name:'O que sua empresa vende?'})).toBeVisible();
      await expect(page.getByRole('radio',{checked:true})).toHaveCount(0);
      await page.getByRole('button',{name:'Continuar',exact:true}).click();
      await expect(page.getByRole('alert')).toContainText('Escolha se sua empresa vende');
      await page.getByRole('radio',{name:/Produtos/}).focus();await page.keyboard.press('Space');
      if(mode==='services')await page.keyboard.press('ArrowRight');
      await expect(page.locator(`input[value="${mode}"]`)).toBeChecked();
      await expect(page.getByRole('radio',{checked:true})).toHaveCount(1);
      await page.reload();await person();
      await expect(page.locator(`input[value="${mode}"]`)).toBeChecked();
      await page.getByLabel('Nome da loja').fill('Empresa Sintética '+mode);
      await page.getByLabel('CPF ou CNPJ').fill('52998224725');
      await page.evaluate(()=>{const label=document.createElement('p');label.textContent='Aplicação local · Cadastro sintético';Object.assign(label.style,{position:'fixed',bottom:'8px',left:'8px',margin:'0',padding:'8px 12px',background:'#143d2b',color:'#fff',font:'12px system-ui',zIndex:'1000',borderRadius:'6px'});document.body.append(label);});
      await page.screenshot({path:resolve(captures,`task10-signup-${mode}.running.png`),fullPage:true});
      await page.getByRole('button',{name:'Continuar',exact:true}).click();
      await page.getByLabel('E-mail corporativo').fill(`t10-${mode}@example.test`);
      await page.getByLabel('Senha',{exact:true}).fill('SyntheticPassword123!');
      await page.getByLabel('Confirmar senha').fill('SyntheticPassword123!');
      await page.getByLabel('Celular').fill('11999999999');
      let fail=true;
      await page.route('**/v1/auth/register',route=>{
        if(fail){fail=false;return route.fulfill({status:409,contentType:'application/json',body:'{"message":"email_already_registered"}'});}
        return route.continue();
      });
      await page.getByRole('button',{name:'Criar conta',exact:true}).click();
      await expect(page.getByRole('alert')).toContainText('Este e-mail já está cadastrado.');
      await page.getByRole('button',{name:'Voltar',exact:true}).click();
      await expect(page.locator(`input[value="${mode}"]`)).toBeChecked();
      await page.getByRole('button',{name:'Continuar',exact:true}).click();
      const registering=page.waitForResponse(response=>response.url().endsWith('/v1/auth/register')&&response.request().method()==='POST');
      const completing=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');
      await page.getByRole('button',{name:'Criar conta',exact:true}).click();
      const registered=await registering;expect(registered.status()).toBe(201);
      expect(registered.request().postDataJSON().business_mode).toBe(mode);
      const completed=await completing;expect(completed.status()).toBe(200);
      expect(completed.request().postDataJSON().business_mode).toBe(mode);
      const auth=await registered.json();
      const profile=await request.get('/v1/merchants/me',{headers:{authorization:'Bearer '+auth.access_token}});
      expect(profile.status()).toBe(200);const data=await profile.json();
      expect(data.businessMode).toBe(mode);expect(data.businessModeSelectionState).toBe('selected');
      expect(data.capabilities.serviceBooking).toBe(false);
      if(mode==='products')expect(data.capabilities.serviceAdministration).toBe(false);
      await page.reload();
      const reopened=await request.get('/v1/merchants/me',{headers:{authorization:'Bearer '+auth.access_token}});
      expect((await reopened.json()).businessMode).toBe(mode);
    }finally{await context.close();}
  }
  const seed=await request.post('/__service/signup-oauth');expect(seed.status()).toBe(200);
  const pending=await seed.json();
  const context=await browser.newContext({baseURL:'http://127.0.0.1:5187'});
  try{
    await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5187'?route.continue():route.abort('blockedbyclient'));
    const page=await context.newPage();await page.goto('/?mode=signin');
    await page.getByLabel('E-mail').fill(pending.email);await page.getByLabel('Senha',{exact:true}).fill(pending.password);
    await page.getByRole('button',{name:'Entrar',exact:true}).last().click();
    await expect(page.getByLabel('Nome completo')).toBeVisible();
    await page.getByLabel('Cargo / papel na empresa').selectOption('owner');await page.getByRole('button',{name:'Continuar',exact:true}).click();
    await page.getByRole('radio',{name:/Serviços/}).check();
    await page.getByLabel('Nome da loja').fill('OAuth Sintético');await page.getByLabel('CPF ou CNPJ').fill('52998224725');
    await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByLabel('Celular').fill('11999999999');
    const completing=page.waitForResponse(response=>response.url().endsWith('/v1/merchants/me/store-settings')&&response.request().method()==='PUT');
    await page.getByRole('button',{name:'Concluir cadastro',exact:true}).click();
    const completed=await completing;expect(completed.status()).toBe(200);expect(completed.request().postDataJSON().business_mode).toBe('services');
    const profile=await request.get('/v1/merchants/me',{headers:{authorization:'Bearer '+pending.access_token}});
    expect((await profile.json()).businessMode).toBe('services');
  }finally{await context.close();}
});

test('T3',async({page,context,request})=>{
  const origin='http://127.0.0.1:5187';
  const response=await request.get('/__service/manifest');
  expect(response.status()).toBe(200);
  const manifest=await response.json();
  expect(manifest.kind).toBe('local-owned');expect(manifest.origin).toBe(origin);
  expect(manifest.runId).toBe(process.env.SERVICE_LOCAL_RUN_ID);
  expect(manifest.metaConnected).toBe(false);expect(manifest.pspConnected).toBe(false);
  const blocked:string[]=[];
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    blocked.push(url.origin);return route.abort('blockedbyclient');
  });
  const captures=resolve(process.cwd(),'../../.specs/features/whatsapp-service-booking-business-rag/captures');
  await mkdir(captures,{recursive:true});
  await page.goto('/');
  await page.getByRole('button',{name:'Entrar',exact:true}).first().click();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
  await expect(page.getByRole('button',{name:/entrar|acessar/i}).first()).toBeVisible();
  await page.evaluate(()=>{const label=document.createElement('div');label.textContent='Aplicação local de teste · Sem conexão com produção';
    Object.assign(label.style,{position:'fixed',top:'0',left:'0',right:'0',padding:'8px',background:'#143d2b',color:'#fff',font:'13px system-ui',textAlign:'center',zIndex:'10000'});document.body.append(label);});
  await page.screenshot({path:resolve(captures,'task3-dashboard-login.running.png'),fullPage:true});
  await page.goto('/__service/whatsapp');
  await page.getByRole('button',{name:'Verificar API local'}).click();
  await expect(page.locator('output')).toHaveText('API local pronta. Banco conectado.');
  await page.screenshot({path:resolve(captures,'task3-whatsapp-fixture.running.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(captures,'task3-whatsapp-fixture-mobile.running.png'),fullPage:true});
  const outside=await page.evaluate(async()=>{try{await fetch('https://example.invalid/forbidden');return 'allowed';}catch{return 'blocked';}});
  expect(outside).toBe('blocked');expect(blocked).toContain('https://example.invalid');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
