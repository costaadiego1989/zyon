import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const folder=fileURLToPath(new URL('../../../.specs/features/admin-company-prospecting/production-release/',import.meta.url));
mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/*',route=>['http://127.0.0.1:5179','http://127.0.0.1:3019'].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
const page=await context.newPage(),results=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
async function measure(area,width){
 const measurements=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,checkboxes:[...document.querySelectorAll('.prospecting-page input[type=checkbox]')].map(input=>{const box=input.getBoundingClientRect();return {width:box.width,height:box.height};}),fields:[...document.querySelectorAll('.prospecting-page input:not([type=checkbox]),.prospecting-page select')].filter(input=>input.getClientRects().length).map(input=>{const box=input.getBoundingClientRect();return {type:input.getAttribute('type'),height:box.height,width:box.width,parentWidth:input.parentElement.getBoundingClientRect().width};})}));
 assert.ok(measurements.documentWidth<=width+1,area+' overflow at '+width);
 for(const box of measurements.checkboxes){assert.ok(box.width<=18&&box.height<=18,'checkbox inherited text-field dimensions');}
 if(width<=760){
  const labels=await page.locator('.prospecting-page .prospecting-check:visible').evaluateAll(items=>items.map(item=>{const box=item.getBoundingClientRect();return {width:box.width,height:box.height};}));
  for(const label of labels)assert.ok(label.width>=44&&label.height>=44,'mobile checkbox label lost its 44px touch target');
  measurements.checkboxLabels=labels;
 }
 for(const field of measurements.fields){assert.ok(field.width<=field.parentWidth+1,'input wider than label');assert.ok(field.height>=(width<=760?44:38),'control too small');if(width>760)assert.ok(field.height<=42,'oversized desktop input');}
 results.push({area,width,...measurements});await page.screenshot({path:folder+area+'-'+width+'.png'});
}
try{
 await page.goto('http://127.0.0.1:5179/');await page.locator('input[type=email]').fill('operador@prospecting.test');await page.locator('input[type=password]').fill('Local-Operador-2026!');await page.getByRole('button',{name:/entrar/i}).click();await page.getByRole('button',{name:/^Prospec/}).click();
 const session=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('zyon.platform-control.session.v1')));
 const response=await page.request.get('http://127.0.0.1:3019/v1/platform/prospecting/campaigns',{headers:{Authorization:'Bearer '+session.token}});assert.equal(response.status(),200);const campaigns=await response.json();assert.ok(campaigns.items.length);const campaign=campaigns.items[0];
 for(const width of [1440,1024,390,320]){
  await page.setViewportSize({width,height:1000});
  await page.goto('http://127.0.0.1:5179/#prospecting/overview');await expect(page.locator('.prospecting-metric')).toHaveCount(10);await measure('general-metrics',width);
  await page.goto('http://127.0.0.1:5179/#prospecting/companies');await page.getByText('Filtros detalhados',{exact:true}).click();await expect(page.locator('.prospecting-check input').first()).toBeVisible();await page.locator('.prospecting-check input').first().check();await expect(page.locator('.prospecting-check input').first()).toBeChecked();await measure('company-filters',width);
  await page.goto('http://127.0.0.1:5179/#prospecting/campaigns');await page.getByRole('button',{name:'Preparar campanha',exact:true}).click();await expect(page.getByRole('group',{name:'Dias de envio'})).toBeVisible();await measure('campaign-form',width);
  await page.goto('http://127.0.0.1:5179/#prospecting/campaigns');await page.getByRole('button',{name:campaign.name,exact:true}).click();await expect(page.getByRole('heading',{name:'M\u00e9tricas da campanha',exact:true})).toBeVisible();await expect(page.locator('.prospecting-metric')).toHaveCount(10);await measure('campaign-metrics',width);
 }
 await page.getByLabel('In\u00edcio (UTC)').fill('2026-11-01');await page.getByLabel('Fim exclusivo (UTC)').fill('2026-12-01');
 const query=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/platform/prospecting/metrics'&&new URL(r.url()).searchParams.get('from')==='2026-11-01T00:00:00.000Z');await page.getByRole('button',{name:'Aplicar per\u00edodo'}).click();const result=await query;assert.equal(result.status(),200);const data=await result.json();assert.equal(data.campaignId,campaign.id);
 await expect(page.locator('.prospecting-metric')).toHaveCount(10);
 const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/platform/prospecting/metrics'&&new URL(r.url()).searchParams.get('from')==='2026-11-01T00:00:00.000Z');await page.getByRole('button',{name:'Atualizar resultados'}).click();assert.equal((await refreshed).status(),200);await expect(page.getByLabel('In\u00edcio (UTC)')).toHaveValue('2026-11-01');await expect(page.getByLabel('Fim exclusivo (UTC)')).toHaveValue('2026-12-01');
 await expect(page.locator('.prospecting-metric')).toHaveCount(10);await page.getByRole('button',{name:'Entregas',exact:true}).click();await expect(page).toHaveURL(new RegExp('campaignId='+campaign.id));assert.ok(page.url().includes('/overview/delivered'));
 await page.getByRole('button',{name:'Voltar ao funil',exact:true}).click();await expect(page.locator('.prospecting-metric')).toHaveCount(10);await expect(page.getByText('Resultados da campanha selecionada, com entregas, respostas e conversões verificadas.',{exact:true})).toBeVisible();
 assert.deepEqual(errors,[]);const proof={at:new Date().toISOString(),status:'passed',screens:results,gesture:{campaignId:campaign.id,from:data.from,to:data.to,drilldown:'delivered'},pageErrors:errors};writeFileSync(folder+'ui-polish-walk.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({status:proof.status,screens:results.length,viewports:[1440,1024,390,320],checkboxMaxHeight:18,drilldownCampaignId:campaign.id,pageErrors:errors.length}));
}catch(error){await page.screenshot({path:folder+'ui-polish-walk-failure.png'}).catch(()=>{});throw error;}
finally{await context.close();await browser.close();}
