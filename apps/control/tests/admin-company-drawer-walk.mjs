import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const folder=fileURLToPath(new URL('../../../.specs/features/admin-company-details-billing-fix/',import.meta.url));
mkdirSync(folder,{recursive:true});
const merchant={id:'drawer_fixture',name:'Mercado Aurora de São Paulo',store_slug:'aurora',plan:'BOTH',member_count:1,created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-20T12:00:00Z'};
const detail={merchant:{id:merchant.id,name:merchant.name,plan:'BOTH',createdAt:merchant.created_at,registrationEmail:'titular@aurora.test',company:{cnpj:'00ABC345000135',razaoSocial:'Aurora Comércio Ltda',inscricaoEstadual:'ISENTO',email:'contato@aurora.test',phone:'+5511998765432',address:{street:'Rua Um',number:'10',city:'São Paulo',state:'SP',zip:'01001000'}}},period:{from:'2026-11-01',to:'2026-12-01'},orders:{allTimeCount:0,allTimeTotalMinor:0,periodCount:0,periodTotalMinor:0,series:[]},billing:{overdueCount:0,openReceivableCount:0},ai:{chatTokens:'0',voiceTokens:'0',chatKnownCostMicros:'0',voiceKnownCostMicros:'0',knownCostMicros:'0',unpricedEvents:0},recentOrders:[]};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/*',route=>{
 const url=new URL(route.request().url());
 if(!['http://127.0.0.1:5179','http://127.0.0.1:3019'].includes(url.origin))return route.abort();
 if(url.origin==='http://127.0.0.1:3019'&&url.pathname==='/v1/platform/merchants')return route.fulfill({json:{items:[merchant],next_cursor:null}});
 if(url.origin==='http://127.0.0.1:3019'&&url.pathname==='/v1/platform/merchants/drawer_fixture/detail')return route.fulfill({json:detail});
 return route.continue();
});
const page=await context.newPage(),errors=[],screens=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5179/');
 await page.locator('input[type=email]').fill('operador@prospecting.test');await page.locator('input[type=password]').fill('Local-Operador-2026!');
 await page.getByRole('button',{name:/entrar/i}).click();await page.getByRole('button',{name:'Empresas',exact:true}).click();
 const search=page.getByRole('textbox',{name:'Buscar empresa'});
 await search.fill('Mercado');await page.getByRole('button',{name:'Buscar',exact:true}).click();
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});
  const trigger=page.getByRole('button',{name:'Abrir detalhes de '+merchant.name,exact:true});
  await trigger.click();const dialog=page.locator('dialog.merchant-detail-drawer:modal');await expect(dialog).toBeVisible();
  await expect(dialog.getByText('00.ABC.345/0001-35',{exact:true})).toBeVisible();await expect(dialog.getByText('(11) 99876-5432',{exact:true})).toBeVisible();
  const close=dialog.getByRole('button',{name:'Fechar detalhes',exact:true});await expect(close).toBeFocused();
  await page.keyboard.press('Tab');await expect(dialog.getByRole('link',{name:'contato@aurora.test',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(dialog.getByRole('link',{name:'titular@aurora.test',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('link',{name:'titular@aurora.test',exact:true})).toBeFocused();
  const measured=await dialog.evaluate(node=>{const b=node.getBoundingClientRect();return{left:b.left,right:b.right,width:b.width,height:b.height,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth};});
  assert.equal(Math.round(measured.right),width);assert.equal(Math.round(measured.width),Math.min(width,560));assert.equal(Math.round(measured.height),1000);assert.equal(measured.documentWidth,width);
  const metrics=await dialog.locator('.detail-facts').evaluate(node=>({height:node.clientHeight,contentHeight:node.scrollHeight}));
  assert.ok(metrics.height>=metrics.contentHeight-1,'company metrics are clipped inside their container');
  await page.screenshot({path:folder+'company-drawer-'+width+'.png'});screens.push({width,...measured});
  await page.keyboard.press('Escape');await expect(page.locator('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();await expect(search).toHaveValue('Mercado');
  await trigger.click();await dialog.getByRole('button',{name:'Fechar detalhes',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();
  if(width>560){await trigger.click();await expect(dialog).toBeVisible();await page.mouse.click(20,180);await expect(page.locator('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();}
 }
 assert.deepEqual(errors,[]);const proof={status:'passed',at:new Date().toISOString(),source:'actual local Control with isolated HTTP fixtures',screens,naturalKeyboard:true,escape:true,closeButton:true,desktopBackdrop:true,retainedSearch:'Mercado',pageErrors:errors};
 writeFileSync(folder+'browser-walk.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({status:'passed',viewports:screens.map(s=>s.viewport),nativeDialog:true,naturalKeyboard:true,pageErrors:errors.length}));
}catch(error){await page.screenshot({path:folder+'browser-failure.png'}).catch(()=>{});throw error;}
finally{await context.close();await browser.close();}
