import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {ensureCampaignPreview,campaignFolder} from './prospecting-campaign-flow-preview.mjs';
const require=createRequire(new URL('../package.json',import.meta.url)),{chromium,expect}=require('@playwright/test');
const apiRequire=createRequire(new URL('../../api/package.json',import.meta.url)),{Pool}=apiRequire('pg');
const runtime=await ensureCampaignPreview(),origins=runtime.origins;
for(const origin of Object.values(origins))assert.equal(new URL(origin).hostname,'127.0.0.1');
assert.match(runtime.database,/^prospecting_test_[a-f0-9]{32}$/);
const config=JSON.parse(readFileSync(new URL('../../../.specs/features/admin-company-prospecting/environment.local.json',import.meta.url),'utf8'));
const dbUrl=new URL(config.databaseUrl);assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'15438');dbUrl.pathname='/'+runtime.database;dbUrl.search='';
const pg=new Pool({connectionString:dbUrl.href,max:1});assert.equal((await pg.query('SELECT owner FROM browser_runtime_owner')).rows[0].owner,runtime.owner);
assert.equal((await pg.query("SELECT count(*)::int AS count FROM company_directory.company_establishments WHERE snapshot_id='search-old' AND uf='SP' AND main_cnae='4781400'")).rows[0].count,25,'owned campaign fixture scope');
const captureFolder=campaignFolder+'captures/';mkdirSync(captureFolder,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Sao_Paulo'});
const allowed=new Set(Object.values(origins));await context.route('**/*',route=>allowed.has(new URL(route.request().url()).origin)?route.continue():route.abort());
const page=await context.newPage(),errors=[],screens=[],campaignIds=[],providerStates=[];page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
const run='flow'+Date.now();let auth;
async function checkLayout(area,width){
 await expect(page.locator('.campaign-workspace [aria-busy="true"]')).toHaveCount(0);
 const measurement=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,fields:[...document.querySelectorAll('.campaign-workspace input:not([type=checkbox]),.campaign-workspace select,.template-manager input')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();return {height:r.height,width:r.width,parent:p.width};})}));
 assert.ok(measurement.documentWidth<=width+1,`${area} overflow at${width}`);
 for(const f of measurement.fields){assert.ok(f.width<=f.parent+1,'field exceeds label');assert.ok(f.height>=(width<=760?44:38),'small control');if(width>760)assert.ok(f.height<=42,'oversized desktop control');}
 await page.screenshot({path:captureFolder+area+'-'+width+'.running.png',fullPage:true});screens.push({area,width,...measurement});
}
try{
 // Cold Vite compilation is a harness startup gate, separate from operator gesture timeouts.
 await page.goto(origins.control,{waitUntil:'domcontentloaded',timeout:120000});await page.locator('input[type=email]').waitFor({state:'visible',timeout:120000});await page.locator('input[type=email]').fill('operador@prospecting.test');await page.locator('input[type=password]').fill('Local-Operador-2026!');
 const login=page.waitForResponse(r=>r.url().endsWith('/platform/auth/login'));await page.getByRole('button',{name:/entrar/i}).click();auth=await(await login).json();assert.equal(auth.role,'platform_admin');
 const headers={Authorization:'Bearer '+auth.access_token};
 assert.equal((await page.request.post(origins.api+'/v1/platform/prospecting/campaign-drafts',{data:{name:'Denied',clientRequestId:run+'denied'}})).status(),401);
 const baseline=(await pg.query('SELECT count(*)::int AS count FROM browser_provider_requests')).rows[0].count;
 for(const width of [1440,1280,1024,390,320]){
  await page.setViewportSize({width,height:1000});
  await page.route('**/v1/platform/prospecting/sender',route=>route.fulfill({status:503,json:{message:'sender_unavailable'}}));
  await page.goto(origins.control+'/#prospecting/campaigns?view=edit');
  // Use the list gesture so the route comes from the application itself.
  await page.goto(origins.control+'/#prospecting/campaigns');await page.getByRole('button',{name:'Criar campanha',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Criar campanha',exact:true})).toBeVisible();await checkLayout('campaign-create',width);
  const name=run+' '+width;await page.getByLabel('Nome da campanha',{exact:true}).fill(name);await page.getByLabel('Contexto das empresas',{exact:true}).fill('lojas de roupas em SP');
  const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/platform/prospecting/campaign-drafts'&&r.request().method()==='POST');await page.getByRole('button',{name:'Criar campanha',exact:true}).click();
  const response=await created;assert.equal(response.status(),201);const draft=await response.json();campaignIds.push(draft.id);
  for(const key of ['message','offer','template','senderBindingId','limits','sendWindow'])assert.equal(draft[key],null,key);assert.equal(draft.offerPolicy.mode,'catalog');
  await expect(page.getByText('25 empresas · 0 adicionadas manualmente',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Preparar revisão da campanha',exact:true})).toBeDisabled();
  let stored=(await pg.query('SELECT setup_version,business_context,audience_criteria,planning_mode,sender_binding_id,budget_cents FROM prospect_campaigns WHERE id=$1',[draft.id])).rows[0];assert.equal(stored.setup_version,2);assert.equal(stored.business_context,'lojas de roupas em SP');assert.deepEqual(stored.audience_criteria,{mainCnaes:['4781400'],ufs:['SP']});assert.equal(stored.planning_mode,'rules');assert.equal(stored.sender_binding_id,null);assert.equal(stored.budget_cents,null);
  await page.reload();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await expect(page.getByText('25 empresas · 0 adicionadas manualmente',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Empresas da campanha'}).locator('.prospecting-row')).toHaveCount(20);const region=page.getByRole('region',{name:'Empresas da campanha'});await region.focus();await page.keyboard.press('End');assert.ok(await region.evaluate(n=>n.scrollTop>0));await page.getByRole('button',{name:'Próximas empresas',exact:true}).click();await expect(region.locator('.prospecting-row')).toHaveCount(5);await page.getByRole('button',{name:'Primeira página de empresas',exact:true}).click();await expect(region.locator('.prospecting-row')).toHaveCount(20);await checkLayout('campaign-workspace',width);
  await page.getByRole('button',{name:'Preparar mensagem',exact:true}).click();await expect(page.getByLabel('Nome da mensagem',{exact:true})).toBeFocused();let templateName=run+'_'+width;
  await page.getByLabel('Nome da mensagem',{exact:true}).fill(templateName);const body='Olá! Aqui é a equipe da Zyon. Podemos conversar sobre sua loja? Se não quiser mensagens, avise por aqui.';await page.getByLabel('Texto da mensagem',{exact:true}).fill(body);const templateCreated=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/platform/prospecting/sender/templates'&&r.request().method()==='POST');await page.getByRole('button',{name:'Salvar rascunho da mensagem',exact:true}).click();templateName=(await(await templateCreated).json()).name;
  await expect(page.getByRole('button',{name:'Preparar mensagem',exact:true})).toBeFocused();const message=page.getByRole('article',{name:'Mensagem '+templateName,exact:true});await expect(message).toContainText('Rascunho · Não enviado à Meta');await expect(message).toContainText(body);await expect(message.getByRole('button',{name:'Enviar '+templateName+' à Meta',exact:true})).toBeDisabled();
  await message.getByRole('button',{name:'Usar '+templateName+' nesta campanha',exact:true}).click();await expect(message).toContainText('Texto selecionado nesta campanha.');assert.equal((await pg.query('SELECT message FROM prospect_campaigns WHERE id=$1',[draft.id])).rows[0].message,body);
  await page.unroute('**/v1/platform/prospecting/sender');await page.reload();await expect(message.getByRole('button',{name:'Enviar '+templateName+' à Meta',exact:true})).toBeEnabled();
  await message.getByRole('button',{name:'Enviar '+templateName+' à Meta',exact:true}).click();await expect(message).toContainText('Em análise pela Meta');providerStates.push('PENDING');await message.getByRole('button',{name:'Atualizar estado de '+templateName+' na Meta',exact:true}).click();await expect(message).toContainText('Aprovado pela Meta');providerStates.push('APPROVED');const messages=page.getByRole('region',{name:'Mensagens disponíveis',exact:true});await messages.focus();await page.keyboard.press('End');assert.ok(await messages.evaluate(n=>n.scrollHeight<=n.clientHeight||n.scrollTop>0));await message.locator('header').scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Preparar mensagem',exact:true}).focus();await checkLayout('campaign-message',width);
  // Current browser selection is transferred through the real HTTP append contract.
  await page.goto(origins.control+'/#prospecting/companies');await page.getByLabel('Selecionar 00000000000191',{exact:true}).check();await page.getByRole('button',{name:'Adicionar à campanha',exact:true}).click();await expect(page.getByLabel('Campanha existente',{exact:true})).toBeFocused();await page.getByLabel('Campanha existente',{exact:true}).selectOption(draft.id);await page.getByRole('button',{name:'Adicionar à campanha escolhida',exact:true}).click();await expect(page.getByText('1 adicionada(s) e 0 já existente(s) nesta campanha.',{exact:true})).toBeVisible();await expect(page.getByLabel('Selecionar 00000000000191',{exact:true})).toBeChecked();
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM prospect_campaign_companies WHERE campaign_id=$1 AND removed_at IS NULL',[draft.id])).rows[0].count,1);
  await page.getByRole('button',{name:'Fechar seleção de campanha',exact:true}).click();await expect(page.getByRole('button',{name:'Adicionar à campanha',exact:true})).toBeFocused();await checkLayout('campaign-search-transfer',width);
  await page.goto(origins.control+'/#prospecting/campaigns/'+draft.id+'?view=edit');await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await page.getByLabel('Destinatários por dia',{exact:true}).fill('2');await page.getByLabel('Orçamento total (R$)',{exact:true}).fill('10,00');await page.getByRole('button',{name:'Salvar configuração de envio',exact:true}).click();await expect(page.getByRole('button',{name:'Preparar revisão da campanha',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Preparar revisão da campanha',exact:true}).click();await expect(page.getByRole('button',{name:'Aprovar revisão da campanha',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Aprovar revisão da campanha',exact:true}).click();await expect(page.getByText(/Revisão da campanha aprovada · Revisão/)).toBeVisible();await page.getByRole('button',{name:'Iniciar campanha',exact:true}).click();await expect(page.getByText('Envio impedido pela política do provedor',{exact:true})).toBeVisible();
  stored=(await pg.query('SELECT state,approved_revision,revision FROM prospect_campaigns WHERE id=$1',[draft.id])).rows[0];assert.equal(stored.state,'approved');assert.equal(stored.approved_revision,stored.revision);assert.equal((await pg.query('SELECT count(*)::int AS count FROM outreach_attempts a JOIN campaign_recipients r ON r.id=a.recipient_id WHERE r.campaign_id=$1',[draft.id])).rows[0].count,0);
  assert.equal((await page.request.get(origins.api+'/v1/platform/prospecting/campaign-drafts/'+draft.id,{headers})).status(),200);
 }
 for(const variant of ['reject','unknown','mismatch']){
  await page.getByRole('button',{name:'Preparar mensagem',exact:true}).click();await page.getByLabel('Nome da mensagem',{exact:true}).fill(run+'_'+variant);const body='Mensagem local para validar o estado '+variant+'.';await page.getByLabel('Texto da mensagem',{exact:true}).fill(body);
  const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/platform/prospecting/sender/templates'&&r.request().method()==='POST');await page.getByRole('button',{name:'Salvar rascunho da mensagem',exact:true}).click();const t=await(await created).json();const row=page.getByRole('article',{name:'Mensagem '+t.name,exact:true});await expect(row).toContainText(body);await row.getByRole('button',{name:'Enviar '+t.name+' à Meta',exact:true}).click();
  if(variant==='unknown'){
   await expect(row).toContainText('Resultado do envio à Meta desconhecido');assert.equal(await row.getByRole('button',{name:'Enviar '+t.name+' à Meta',exact:true}).count(),0);await row.getByRole('button',{name:'Confirmar resultado de '+t.name,exact:true}).click();await expect(row).toContainText('Em análise pela Meta');providerStates.push('submission_unknown','PENDING');
  }else{
   await row.getByRole('button',{name:'Atualizar estado de '+t.name+' na Meta',exact:true}).click();
   if(variant==='reject'){await expect(row).toContainText('Rejeitado pela Meta');await expect(row).toContainText('Controlled provider rejection');providerStates.push('REJECTED');}
   else{await expect(row.locator('header p').first()).toContainText('Conteúdo diferente do aprovado na Meta');await expect(row).toContainText('O texto salvo abaixo não está aprovado para envio');await expect(row.getByRole('button',{name:'Usar '+t.name+' nesta campanha',exact:true})).toBeDisabled();providerStates.push('APPROVED_content_mismatch');}
  }
 }
 await checkLayout('campaign-provider-states',320);
 assert.equal((await pg.query('SELECT count(*)::int AS count FROM browser_provider_requests')).rows[0].count,baseline);assert.deepEqual(errors,[]);
 const receipt={status:'passed',source:'actual local Control gestures, Nest HTTP and PostgreSQL; provider template observations are controlled fixtures',at:new Date().toISOString(),viewports:[1440,1280,1024,390,320],screens,campaignIds,providerStates,pageErrors:errors,externalRealCalls:0,launchesBlockedByNoOptIn:true,origins};
 writeFileSync(campaignFolder+'browser-walk.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,screens:screens.length,campaigns:campaignIds.length,viewports:receipt.viewports,externalRealCalls:0}));
}catch(error){await page.screenshot({path:captureFolder+'walk-failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await context.close();await browser.close();await pg.end();}
