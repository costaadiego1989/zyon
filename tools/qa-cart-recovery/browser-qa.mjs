import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(toolDir, '../../apps/dashboard/package.json'));
const { chromium } = require('@playwright/test');
const here = path.join(toolDir, '.artifacts');
fs.mkdirSync(here, {recursive:true});
const browser = await chromium.launch({headless:true});
const results = [];
const errors = [];
const page = await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror', error => errors.push(error.message));
let config = { active_strategy:'offer_coupon', coupon_code:'SAVE10', rule_id:'rule-1' };
let rejectPatch = false, rejectLoad = false, emptyOptions = false;
const patches = [];
const templates = {
  email:{subject:'{{storeName}} | Continue sua compra',body:'Olá, {{buyerName}}! Revise seu carrinho na {{storeName}}.\n{{link}}'},
  whatsapp:{body:'Olá, {{buyerName}}! Revise seu carrinho na {{storeName}}.\n{{link}}',revision:1,status:'approved',rejectionReason:null},
  whatsappConnected:true,effectiveChannel:'whatsapp',
};
await page.route('**/mock/**', async route => {
  const req=route.request(), url=new URL(req.url());
  let data={}, status=200;
  if (url.pathname.endsWith('/cart-recovery/config')) {
    if(req.method()==='PATCH') {
      patches.push(req.postDataJSON());
      if(rejectPatch) { status=500; data={message:'Falha simulada ao salvar'}; }
      else { config={...config,...req.postDataJSON()}; data={config}; }
    } else { status=rejectLoad?500:200; data={config}; }
  } else if (url.pathname.endsWith('/cart-recovery/metrics')) data={total_abandoned:20,total_attempts:4,total_recovered:1,revenue_recovered_brl:89};
  else if (url.pathname.endsWith('/cart-recovery/attempts')) data={data:[{id:'a1',session_id:'session-1',strategy:'offer_coupon',status:'unknown',created_at:'2026-09-14T12:00:00Z'}]};
  else if (url.pathname.endsWith('/merchant/coupons')) data=emptyOptions?[]:[
    {id:'c1',code:'SAVE10',discount_type:'percent',discount_value:10,status:'active'},
    {id:'c2',code:'SAVE20',discount_type:'percent',discount_value:20,status:'active'},
    {id:'c3',code:'EXPIRED',discount_type:'percent',discount_value:90,status:'active',ends_at:'2020-01-01'},
    {id:'c4',code:'EXHAUSTED',discount_type:'percent',discount_value:90,status:'active',max_usages:1,usages_count:1},
  ];
  else if (url.pathname.endsWith('/checkout-settings')) data={advancedRules:emptyOptions?[]:[{id:'rule-1',name:'Regra válida',enabled:true},{id:'rule-off',name:'Regra desativada',enabled:false}]};
  else if (url.pathname.endsWith('/cart-recovery/templates')) data=templates;
  else if (url.pathname.includes('faq')) data=[];
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
});
async function check(name, run) { await run(); results.push(name); console.log('PASS ' + name); }
async function load(surface='recovery') { await page.goto('http://127.0.0.1:5198/__qa?surface='+surface); await page.waitForTimeout(250); }
try {
  await load();
  await page.getByRole('radio',{name:/Cupom de Desconto/}).waitFor();
  await check('unknown provider outcome is visible',async()=>assert.equal(await page.getByText('Aguardando confirmação',{exact:true}).count(),1));
  for (const name of ['Frete Grátis','Cross-sell','Regra Avançada','Cupom de Desconto']) {
    await check('strategy saves exactly once: '+name,async()=>{
      const before=patches.length;
      await Promise.all([page.waitForResponse(res=>res.url().endsWith('/cart-recovery/config') && res.request().method()==='PATCH'),page.getByRole('radio',{name:new RegExp(name)}).click()]);
      await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled);
      assert.equal(patches.length,before+1);
      assert.equal(await page.getByRole('radio',{name:new RegExp(name)}).isChecked(),true);
    });
  }
  await check('failed strategy save keeps authoritative selection',async()=>{
    rejectPatch=true;
    await Promise.all([page.waitForResponse(res=>res.url().endsWith('/cart-recovery/config') && res.request().method()==='PATCH'),page.getByRole('radio',{name:/Cross-sell/}).click()]);
    await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled);
    assert.equal(await page.getByRole('radio',{name:/Cupom de Desconto/}).isChecked(),true);
    rejectPatch=false;
  });
  await check('coupon data and failed save preserve panel',async()=>{
    await page.getByRole('button',{name:'Alterar vínculo'}).click();
    assert.equal(await page.getByText('EXPIRED',{exact:true}).count(),0);
    assert.equal(await page.getByText('EXHAUSTED',{exact:true}).count(),0);
    assert.equal(await page.getByText('20% de desconto',{exact:true}).count(),1);
    rejectPatch=true;
    await page.getByRole('button',{name:/SAVE20/}).click();
    await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled);
    assert.equal(await page.getByRole('heading',{name:'Vincular Cupom'}).count(),1);
    rejectPatch=false;
    await page.getByRole('button',{name:/SAVE20/}).click();
    await page.getByRole('heading',{name:'Vincular Cupom'}).waitFor({state:'hidden'});
    assert.equal(config.coupon_code,'SAVE20'); assert.equal(config.rule_id,'rule-1');
  });
  await check('tabs switch by keyboard and retain selected strategy',async()=>{
    const tab=page.getByRole('tab',{name:'Visão geral',exact:true});
    await tab.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab',{name:'Mensagens',exact:true}).getAttribute('aria-selected'),'true');
    await page.keyboard.press('Home');
    assert.equal(await page.getByRole('radio',{name:/Cupom de Desconto/}).isChecked(),true);
  });
  for(const width of [1440,1280,1024,768,430,390,360,320]) {
    await page.setViewportSize({width,height:900});
    await check('recovery has no horizontal overflow at '+width,async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true));
    if(width===1440||width===390) {
      await page.screenshot({path:here+'/recovery-'+width+'.png',fullPage:true});
      await page.locator('.recovery-strategies').screenshot({path:here+'/strategies-'+width+'.png'});
    }
  }
  await check('mobile coupon panel stays within viewport',async()=>{
    await page.getByRole('button',{name:'Alterar vínculo'}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('h2')].find(el=>el.textContent==='Vincular Cupom')?.parentElement.parentElement.getBoundingClientRect().right<=innerWidth+1);
    const rect=await page.getByRole('heading',{name:'Vincular Cupom'}).evaluate(el=>el.parentElement.parentElement.getBoundingClientRect().toJSON());
    assert.ok(rect.x>=-1); assert.ok(rect.right<=321);
    await page.getByRole('button',{name:'Fechar',exact:true}).click();
  });
  emptyOptions=true; await load();
  await check('coupon and rule lists use shared empty states',async()=>{
    await page.getByRole('button',{name:'Alterar vínculo'}).click();
    assert.equal(await page.locator('[data-ui="empty-state"]').filter({hasText:'Nenhum cupom disponível'}).count(),1);
    await page.getByRole('button',{name:'Fechar',exact:true}).click();
    await Promise.all([page.waitForResponse(res=>res.url().endsWith('/cart-recovery/config') && res.request().method()==='PATCH'),page.getByRole('radio',{name:/Regra Avançada/}).click()]);
    await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled);
    await page.getByRole('button',{name:'Vincular',exact:true}).click();
    assert.equal(await page.locator('[data-ui="empty-state"]').filter({hasText:'Nenhuma regra ativa'}).count(),1);
  });
  rejectLoad=true; await load();
  await check('configuration failure is retryable, not an empty success',async()=>{
    await page.getByText('Recuperação indisponível',{exact:true}).waitFor();
    assert.equal(await page.getByRole('radio').count(),0);
    rejectLoad=false;
    await page.getByRole('button',{name:'Tentar novamente'}).click();
    await page.getByRole('radio',{name:/Regra Avançada/}).waitFor();
  });
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1000}); await load('primitives');
    await check('headers and shared controls at '+width,async()=>{
      const gaps=await page.locator('[data-layout]').evaluateAll(nodes=>nodes.map(el=>el.querySelector('[data-after-header]').getBoundingClientRect().top-el.querySelector('header').getBoundingClientRect().bottom));
      assert.deepEqual(gaps,[24,24]);
      assert.equal(await page.locator('.tab-bar').count(),2);
      assert.equal(await page.locator('[data-ui="empty-state"]').count(),2);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    });
    if(width!==320) await page.screenshot({path:here+'/consistency-'+width+'.png',fullPage:true});
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(here+'/browser-results.json',JSON.stringify({passed:results.length,results,pageErrors:errors},null,2));
} catch(error) { console.log(JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(0,2000)})); throw error; }
finally { await browser.close(); }
