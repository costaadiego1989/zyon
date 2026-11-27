import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../package.json',import.meta.url)),{chromium,expect}=require('@playwright/test');
const folder=fileURLToPath(new URL('../../../.specs/features/admin-prospecting-progressive/',import.meta.url));mkdirSync(folder,{recursive:true});
const origins=JSON.parse(readFileSync(folder+'browser-runtime.json','utf8').replace(/^\uFEFF/, '')).origins;
for(const origin of Object.values(origins))assert.equal(new URL(origin).hostname,'127.0.0.1');
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Sao_Paulo'});
let version=0,paused=false,companyCalls=0;
const coverage=()=>({kind:'regional_retail',ufs:['SP','RJ','MG','ES','PR','SC','RS'],mainCnaes:['4781400'],companyCount:version?2000:500,maximumDirectoryBytes:25_000_000_000,scopeComplete:false});
await context.route('**/*',route=>{
 const url=new URL(route.request().url());if(!Object.values(origins).includes(url.origin))return route.abort();
 if(url.pathname==='/v1/platform/prospecting/readiness')return route.fulfill({json:{source:{status:'current',value:{snapshotId:version?'partial-b':'partial-a',state:'published',competence:'2026-11',coverage:coverage(),latestImport:{id:'parent',state:paused?'failed':'importing',phase:paused?'failed':'persisting_establishments',committedCount:4000,selectedCompanies:1000000,validatedFiles:23,totalFiles:23,errorCode:paused?'source_unavailable':null,updatedAt:'2026-11-23T20:00:00Z'}}}}});
 if(url.pathname==='/v1/platform/prospecting/companies'){
  companyCalls++;const id=url.searchParams.get('snapshotId');assert.ok(['partial-a','partial-b'].includes(id));
  return route.fulfill({json:{snapshotId:id,competence:'2026-11',count:id==='partial-a'?500:2000,countState:'complete',filterHash:'partial',nextCursor:null,items:[{cnpj:'11222333000181',legalName:'Varejo de Florianópolis',uf:'SC',capitalCents:'12345',contacts:[]}]}});
 }
 if(url.pathname==='/v1/platform/prospecting/companies/domains')return route.fulfill({json:{snapshotId:version?'partial-b':'partial-a',competence:'2026-11',items:url.searchParams.get('kind')==='municipios'?[{kind:'municipios',code:'8105',label:'FLORIANOPOLIS'}]:url.searchParams.get('kind')==='cnaes'?[{kind:'cnaes',code:'4781400',label:'Vestuário'}]:[],nextCursor:null}});
 return route.continue();
});
const page=await context.newPage(),errors=[],screens=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(origins.control);await page.locator('input[type=email]').fill('operador@prospecting.test');await page.locator('input[type=password]').fill('Local-Operador-2026!');await page.getByRole('button',{name:/entrar/i}).click();
 await page.getByRole('button',{name:'Prospecção',exact:true}).click();await page.getByRole('link',{name:'Buscar empresas',exact:true}).click();
 for(const width of [1440,390,320]){
  version=0;paused=false;await page.setViewportSize({width,height:1000});await page.reload({waitUntil:'domcontentloaded'});
  const area=page.getByRole('article',{name:'Buscar empresas',exact:true});await expect(area.getByText('Base em carga',{exact:true})).toBeVisible();await expect(area.getByText(/500 empresas disponíveis/)).toBeVisible();
  await area.getByLabel('UF',{exact:true}).selectOption('SC');const details=area.locator('details');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();
  await area.getByLabel('Município',{exact:true}).selectOption('8105');await area.getByLabel('CNAE principal',{exact:true}).selectOption('4781400');await area.getByRole('button',{name:'Aplicar filtros',exact:true}).click();
  const selected=area.getByLabel('Selecionar 11222333000181',{exact:true});await selected.check();await expect(area.getByRole('button',{name:'Atualizar base',exact:true})).toBeDisabled();
  version=1;await selected.uncheck();await area.getByRole('button',{name:'Atualizar base',exact:true}).click();await expect(area.getByText(/2.000 empresas disponíveis/)).toBeVisible();
  await expect(area.getByLabel('UF',{exact:true})).toHaveValue('SC');await expect(area.getByLabel('Município',{exact:true})).toHaveValue('8105');await expect(area.getByLabel('CNAE principal',{exact:true})).toHaveValue('4781400');
  const dimensions=await area.evaluate(n=>({width:innerWidth,document:document.documentElement.scrollWidth,client:n.clientWidth,scroll:n.scrollWidth}));assert.equal(dimensions.document,width);assert.ok(dimensions.scroll<=dimensions.client);screens.push(dimensions);
  await area.getByRole('heading',{name:'Buscar empresas',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:folder+'partial-'+width+'.png'});
  paused=true;await area.getByRole('button',{name:'Atualizar base',exact:true}).click();await expect(area.getByRole('alert')).toContainText('Carga interrompida');await selected.check();await expect(area.getByRole('button',{name:'Adicionar ao CRM',exact:true})).toBeEnabled();
  await area.getByRole('heading',{name:'Buscar empresas',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:folder+'paused-'+width+'.png'});
 }
 assert.deepEqual(errors,[]);const result={status:'passed',source:'actual local Control, genuine local sign-in and controlled directory HTTP fixtures',screens,companyCalls,pageErrors:errors,writesPerformed:0};writeFileSync(folder+'browser-walk.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await context.close();await browser.close();}
