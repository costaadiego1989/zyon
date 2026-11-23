import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../package.json',import.meta.url)),{chromium,expect}=require('@playwright/test');
const folder=fileURLToPath(new URL('../../../.specs/features/admin-prospecting-search-ui/',import.meta.url));mkdirSync(folder,{recursive:true});
const {origin}=JSON.parse(readFileSync(folder+'browser-runtime.json','utf8').replace(/^\uFEFF/,''));assert.equal(new URL(origin).hostname,'127.0.0.1');
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Sao_Paulo'});
let version=0;const calls=[];
await context.route('**/*',route=>{
 const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
 if(url.pathname==='/v1/platform/prospecting/readiness')return route.fulfill({json:{source:{status:'current',value:{snapshotId:version?'view-b':'view-a',state:'published',competence:'2026-11',coverage:{kind:'regional_retail',ufs:['SP','RJ','MG','ES','PR','SC','RS'],mainCnaes:['4781400'],companyCount:version?81:53,maximumDirectoryBytes:25_000_000_000,scopeComplete:false},latestImport:{id:'parent',state:'importing',updatedAt:'2026-11-23T21:00:00Z'}}}}});
 if(url.pathname==='/v1/platform/prospecting/companies'){
  assert.equal(url.searchParams.get('limit'),'20');const snapshotId=url.searchParams.get('snapshotId');assert.ok(['view-a','view-b'].includes(snapshotId));
  const filters=JSON.parse(url.searchParams.get('filters')),offset=Number((url.searchParams.get('cursor')??'offset:0').split(':')[1]),count=filters.search==='nenhuma'?0:snapshotId==='view-b'?81:53;
  calls.push({snapshotId,filters,offset});
  return route.fulfill({json:{snapshotId,competence:'2026-11',count,countState:'complete',filterHash:'fixture',nextCursor:offset+20<count?'offset:'+(offset+20):null,items:Array.from({length:Math.max(0,Math.min(20,count-offset))},(_,i)=>({cnpj:String(offset+i+1).padStart(14,'0'),legalName:'Empresa '+(offset+i+1),uf:'SC',cityCode:'8105',mainCnae:'4781400',capitalCents:'10000',contacts:[]}))}});
 }
 if(url.pathname==='/v1/platform/prospecting/companies/domains'){
  const kind=url.searchParams.get('kind'),more=url.searchParams.has('afterCode');
  return route.fulfill({json:{snapshotId:version?'view-b':'view-a',competence:'2026-11',items:kind==='municipios'?[{kind,code:more?'8105':'8031',label:more?'FLORIANOPOLIS':'BALNEARIO CAMBORIU'}]:kind==='cnaes'?[{kind,code:'4781400',label:'Vestuário'}]:[],nextCursor:kind==='municipios'&&!more?'8031':null}});
 }
 return route.continue();
});
const page=await context.newPage(),errors=[],screens=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(origin);await page.locator('input[type=email]').fill('operador@prospecting.test');await page.locator('input[type=password]').fill('Local-Operador-2026!');await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.getByRole('button',{name:'Prospecção',exact:true}).click();await page.getByRole('link',{name:'Buscar empresas',exact:true}).click();
 for(const width of [1440,390,320]){
  version=0;await page.setViewportSize({width,height:1000});await page.reload({waitUntil:'domcontentloaded'});
  const area=page.getByRole('article',{name:'Buscar empresas',exact:true}),nav=area.getByRole('navigation',{name:'Paginação de empresas',exact:true});
  await expect(nav).toContainText('Página 1 de 3');await expect(area.locator('.prospecting-row')).toHaveCount(20);
  await area.getByLabel('UF',{exact:true}).selectOption('SC');const details=area.locator('details');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();
  await area.getByRole('button',{name:'Mais opções de município',exact:true}).click();await expect(area.getByLabel('Município',{exact:true}).locator('option')).toHaveCount(3);
  await area.getByLabel('Município',{exact:true}).selectOption('8105');await area.getByLabel('CNAE principal',{exact:true}).selectOption('4781400');await area.getByRole('button',{name:'Aplicar filtros',exact:true}).click();
  await expect(area.getByText('Aplique os filtros para usar a seleção.',{exact:true})).toHaveCount(0);await expect(area.getByText(/Competência/)).toHaveCount(0);assert.equal((await area.innerText()).match(/53 empresas/g)?.length,1);
  const d=await area.evaluate(n=>({width:innerWidth,document:document.documentElement.scrollWidth,client:n.clientWidth,scroll:n.scrollWidth}));assert.equal(d.document,width);assert.ok(d.scroll<=d.client);screens.push(d);
  await area.getByRole('heading',{name:'Buscar empresas',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:folder+'filters-'+width+'.png'});
  await details.locator('summary').click();await area.getByLabel('Selecionar 00000000000001',{exact:true}).check();await nav.getByRole('button',{name:'Próxima página',exact:true}).click();await expect(nav).toContainText('Página 2 de 3');
  await nav.getByRole('button',{name:'Próxima página',exact:true}).click();await expect(nav).toContainText('Página 3 de 3');await expect(area.locator('.prospecting-row')).toHaveCount(13);await expect(nav.getByRole('button',{name:'Próxima página',exact:true})).toBeDisabled();
  await nav.getByRole('button',{name:'Página anterior',exact:true}).click();await expect(nav).toContainText('Página 2 de 3');await nav.getByRole('button',{name:'Primeira página',exact:true}).click();await expect(area.getByLabel('Selecionar 00000000000001',{exact:true})).toBeChecked();
  await area.getByLabel('Selecionar 00000000000001',{exact:true}).uncheck();version=1;await area.getByRole('button',{name:'Atualizar base',exact:true}).click();await expect(nav).toContainText('Página 1 de 5');await expect(area.getByLabel('UF',{exact:true})).toHaveValue('SC');
  await expect(area.getByLabel('Município',{exact:true})).toHaveValue('8105');await expect(area.getByLabel('CNAE principal',{exact:true})).toHaveValue('4781400');
  await nav.scrollIntoViewIfNeeded();await page.screenshot({path:folder+'results-'+width+'.png'});
 }
 assert.deepEqual(errors,[]);assert.ok(calls.some(c=>c.filters.ufs?.[0]==='SC'&&c.filters.cityCodes?.[0]==='8105'&&c.filters.mainCnaes?.[0]==='4781400'));
 const result={status:'passed',at:new Date().toISOString(),source:'actual local Control, genuine local sign-in and controlled directory HTTP fixtures',screens,companyRequests:calls.length,pageErrors:errors,customerWrites:0};writeFileSync(folder+'browser-walk.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await context.close();await browser.close();}
