import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../package.json',import.meta.url));
const{chromium,expect}=require('@playwright/test');
const folder=fileURLToPath(new URL('../../../.specs/features/admin-prospecting-directory-loading/',import.meta.url));mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
let published=false,companyCalls=0,domainCalls=0,readinessCalls=0;
const ready=()=>({source:{status:published?'current':'unavailable',value:{snapshotId:published?'walk-snapshot':null,state:published?'published':'unavailable',competence:published?'2026-11':null},observedAt:published?'2026-11-22T12:00:00Z':null}});
await context.route('**/*',route=>{
 const url=new URL(route.request().url());
 if(!['http://127.0.0.1:5179','http://127.0.0.1:3019'].includes(url.origin))return route.abort();
 if(url.origin==='http://127.0.0.1:3019'){
  if(url.pathname==='/v1/platform/prospecting/readiness'){readinessCalls++;return route.fulfill({json:ready()});}
  if(url.pathname==='/v1/platform/prospecting/companies'){
   companyCalls++;assert.ok(published,'search was requested before publication');
   return route.fulfill({json:{snapshotId:'walk-snapshot',competence:'2026-11',count:1,countState:'complete',filterHash:'walk',nextCursor:null,items:[{cnpj:'00000000000191',legalName:'Empresa da base publicada',uf:'SP',capitalCents:'123456',contacts:[]}]}});
  }
  if(url.pathname==='/v1/platform/prospecting/companies/domains'){domainCalls++;assert.ok(published,'domain was requested before publication');return route.fulfill({json:{snapshotId:'walk-snapshot',competence:'2026-11',items:[],nextCursor:null}});}
 }
 return route.continue();
});
const page=await context.newPage(),errors=[],screens=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5179/');await page.locator('input[type=email]').fill('operador@prospecting.test');await page.locator('input[type=password]').fill('Local-Operador-2026!');await page.getByRole('button',{name:/entrar/i}).click();
 await page.getByRole('button',{name:'Prospecção',exact:true}).click();await page.getByRole('link',{name:'Buscar empresas',exact:true}).click();
 for(const width of[1440,390,320]){
  await page.setViewportSize({width,height:1000});published=false;
  const before={companyCalls,domainCalls,readinessCalls};await page.reload({waitUntil:'domcontentloaded'});
  const area=page.getByRole('article',{name:'Buscar empresas',exact:true});
  await expect(area.getByRole('heading',{name:'Base nacional em preparação',exact:true})).toBeVisible();await expect(area.locator('[role=alert]')).toHaveCount(0);await expect(area.locator('form')).toHaveCount(0);
  assert.equal(companyCalls,before.companyCalls);assert.equal(domainCalls,before.domainCalls);
  const firstReadiness=readinessCalls;await area.getByRole('button',{name:'Verificar disponibilidade',exact:true}).click();await expect.poll(()=>readinessCalls).toBeGreaterThan(firstReadiness);
  await expect(area.getByRole('heading',{name:'Base nacional em preparação',exact:true})).toBeVisible();assert.equal(companyCalls,before.companyCalls);assert.equal(domainCalls,before.domainCalls);
  const measured=await area.evaluate(node=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth}));assert.equal(measured.documentWidth,width);assert.ok(measured.scrollWidth<=measured.clientWidth);
  await page.screenshot({path:folder+'preparing-'+width+'.png'});
  published=true;await area.getByRole('button',{name:'Verificar disponibilidade',exact:true}).click();await expect(area.getByText('Empresa da base publicada',{exact:true})).toBeVisible();await expect(area.getByRole('heading',{name:'Base nacional em preparação',exact:true})).toHaveCount(0);
  assert.ok(companyCalls>before.companyCalls);assert.ok(domainCalls>before.domainCalls);await expect(area.getByRole('button',{name:'Aplicar filtros',exact:true})).toBeEnabled();
  screens.push({...measured,preparationMadeNoDirectoryRequest:true,refreshStillPreparing:true,publishedCompanyVisible:true});
 }
 assert.deepEqual(errors,[]);writeFileSync(folder+'browser-walk.json',JSON.stringify({status:'passed',at:new Date().toISOString(),source:'actual local Control with isolated availability/directory HTTP fixtures',screens,pageErrors:errors},null,2)+'\n');console.log(JSON.stringify({status:'passed',viewports:screens.map(x=>x.viewport),pageErrors:errors.length,preparationMakesNoDirectoryRequests:true}));
}catch(error){await page.screenshot({path:folder+'browser-failure.png'}).catch(()=>{});throw error;}
finally{await context.close();await browser.close();}
