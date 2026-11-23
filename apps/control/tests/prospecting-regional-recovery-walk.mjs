import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../package.json',import.meta.url)),{chromium,expect}=require('@playwright/test');
const folder=fileURLToPath(new URL('../../../.specs/features/admin-prospecting-import-recovery/',import.meta.url));mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Sao_Paulo'});
let mode='failed',companyCalls=0,domainCalls=0,readyCalls=0;
const coverage={kind:'regional_retail',ufs:['SP','RJ','MG','ES','PR','SC','RS'],mainCnaes:['4781400'],companyCount:12345,maximumDirectoryBytes:25_000_000_000,scopeComplete:true};
const readiness=()=>({source:{status:mode==='published'?'current':'unavailable',value:{snapshotId:mode==='published'?'regional':null,state:mode==='published'?'published':'unavailable',competence:'2026-11',coverage:mode==='published'?coverage:undefined,latestImport:{id:'regional',state:mode==='failed'?'failed':mode==='published'?'published':'importing',phase:mode==='failed'?'failed':'validating_sources',committedCount:0,selectedCompanies:mode==='failed'?0:12345,validatedFiles:6,totalFiles:23,errorCode:mode==='failed'?'production_directory_storage_limit':null,updatedAt:'2026-11-23T12:00:00Z'}}}});
await context.route('**/*',route=>{
 const url=new URL(route.request().url());if(!['http://127.0.0.1:5179','http://127.0.0.1:3019'].includes(url.origin))return route.abort();
 if(url.pathname==='/v1/platform/prospecting/readiness'){readyCalls++;return route.fulfill({json:readiness()});}
 if(url.pathname==='/v1/platform/prospecting/companies'){assert.equal(mode,'published');companyCalls++;return route.fulfill({json:{snapshotId:'regional',competence:'2026-11',count:1,countState:'complete',filterHash:'regional',nextCursor:null,items:[{cnpj:'11222333000181',legalName:'Varejo de Florianópolis',uf:'SC',capitalCents:'12345',contacts:[]}]}});}
 if(url.pathname==='/v1/platform/prospecting/companies/domains'){assert.equal(mode,'published');domainCalls++;return route.fulfill({json:{snapshotId:'regional',competence:'2026-11',items:url.searchParams.get('kind')==='municipios'?[{kind:'municipios',code:'8105',label:'FLORIANOPOLIS'}]:url.searchParams.get('kind')==='cnaes'?[{kind:'cnaes',code:'4781400',label:'Vestuário'}]:[],nextCursor:null}});}
 return route.continue();
});
const page=await context.newPage(),errors=[],screens=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5179/');await page.locator('input[type=email]').fill('operador@prospecting.test');await page.locator('input[type=password]').fill('Local-Operador-2026!');await page.getByRole('button',{name:/entrar/i}).click();
 await page.getByRole('button',{name:'Prospecção',exact:true}).click();await page.getByRole('link',{name:'Buscar empresas',exact:true}).click();
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});mode='failed';const before=companyCalls;await page.reload({waitUntil:'domcontentloaded'});
  const area=page.getByRole('article',{name:'Buscar empresas',exact:true});await expect(area.getByRole('heading',{name:'Importação interrompida por armazenamento'})).toBeVisible();await expect(area.getByRole('alert')).toContainText('A base ainda não foi publicada');assert.equal(companyCalls,before);
  await page.screenshot({path:folder+'failed-'+width+'.png'});
  mode='importing';await area.getByRole('button',{name:'Verificar disponibilidade'}).click();await expect(area.getByRole('heading',{name:'Importando base de empresas'})).toBeVisible();await expect(area.getByText(/12.345 empresas selecionadas/)).toBeVisible();assert.equal(companyCalls,before);
  await page.screenshot({path:folder+'importing-'+width+'.png'});
  mode='published';await area.getByRole('button',{name:'Verificar disponibilidade'}).click();await expect(area.getByText('Varejo do Sudeste e Sul',{exact:true})).toBeVisible();await expect(area.getByText('Varejo de Florianópolis',{exact:true})).toBeVisible();
  await area.getByLabel('UF',{exact:true}).selectOption('SC');const details=area.locator('details');if(!await details.getAttribute('open'))await details.locator('summary').click();await area.getByLabel('Município',{exact:true}).selectOption('8105');await area.getByLabel('CNAE principal',{exact:true}).selectOption('4781400');
  await area.getByRole('button',{name:'Aplicar filtros'}).click();await expect(area.getByText('Varejo de Florianópolis',{exact:true})).toBeVisible();await expect(area.getByLabel('Simples Nacional',{exact:true})).toBeDisabled();
  const dimensions=await area.evaluate(node=>({width:innerWidth,document:document.documentElement.scrollWidth,client:node.clientWidth,scroll:node.scrollWidth}));assert.equal(dimensions.document,width);assert.ok(dimensions.scroll<=dimensions.client);screens.push(dimensions);await page.screenshot({path:folder+'regional-'+width+'.png'});
 }
 assert.deepEqual(errors,[]);const result={status:'passed',source:'actual local Control with controlled directory HTTP fixtures',screens,companyCalls,domainCalls,readyCalls,pageErrors:errors};writeFileSync(folder+'browser-walk.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await context.close();await browser.close();}
