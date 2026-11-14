import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

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
