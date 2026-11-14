import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 20000 });

const auth=JSON.parse(await fs.readFile(process.env.CASHBACK_BROWSER_AUTH_FILE,'utf8'));
const origin=process.env.CASHBACK_WIDGET_ORIGIN, output=process.env.CASHBACK_BROWSER_REPORT_DIR;
assert.ok(['local','homolog'].includes(auth.environment)&&output);
assert.equal(new URL(origin).hostname,auth.environment==='local'?'127.0.0.1':'widget-v2-sandbox.up.railway.app');
const api=auth.baseUrl.replace(/\/$/,'');
const merchantId='qa-cashback-v1-specific';
const wallet=async()=>{const r=await fetch(api+'/buyer/me/cashback?merchant_id='+merchantId,{headers:{authorization:`Bearer ${auth.buyerTokens[merchantId]}`}});assert.equal(r.status,200);const w=await r.json();return {availableCents:w.balance.availableCents,reservedCents:w.balance.reservedCents,pendingCents:w.balance.pendingCents};};
const before=await wallet();assert.deepEqual(before,{availableCents:3500,reservedCents:1500,pendingCents:0});
const results=[],responses=[],errors=[];
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport,timezoneId:'America/Sao_Paulo'});
  await context.addInitScript(config=>sessionStorage.setItem('aacp_checkout_session',JSON.stringify(config)),{
   embedToken:auth.tokens.embedEditableWidget,merchantId,apiBaseUrl:api,globalUserId:auth.ids.buyerId,
  });
  const page=await context.newPage();page.setDefaultTimeout(18000);
  page.on('pageerror',e=>errors.push({viewport:viewport.width,message:String(e.message).slice(0,500)}));
  page.on('response',r=>{const u=new URL(r.url());if(u.origin===new URL(api).origin&&/\/embed\/(?:cashback|start)/.test(u.pathname))responses.push({viewport:viewport.width,path:u.pathname,method:r.request().method(),status:r.status()});});
  try{
   await page.goto(origin+'/');
   await page.getByRole('button',{name:/^Por chat/}).click();
   if(viewport.width===390)await page.getByRole('button',{name:'Abrir carrinho',exact:true}).click();
   const cashback=page.getByRole('region',{name:'Cashback nesta compra'});
   await expect(cashback).toBeVisible();
   await expect(cashback.getByRole('button',{name:'Usar cashback',exact:true})).toBeEnabled();
   await cashback.getByLabel('Valor de cashback a utilizar',{exact:true}).fill('10.00');
   await cashback.getByRole('button',{name:'Usar cashback',exact:true}).click();
   await expect(cashback.getByRole('button',{name:'Remover cashback',exact:true})).toBeEnabled();
   await expect(cashback).toContainText('R$ 10,00');
   assert.deepEqual(await wallet(),{availableCents:2500,reservedCents:2500,pendingCents:0});
   await cashback.screenshot({path:path.join(output,`widget-reserved-${viewport.width}.png`)});
   await cashback.getByRole('button',{name:'Remover cashback',exact:true}).click();
   await expect(cashback.getByRole('button',{name:'Usar cashback',exact:true})).toBeEnabled();
   assert.deepEqual(await wallet(),before);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(output,`widget-restored-${viewport.width}.png`),fullPage:true});
   results.push({viewport,pass:true,reservedCents:1000,restored:true,realServedWidget:true});
  }catch(error){
   results.push({viewport,pass:false,error:String(error.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[REDACTED]').slice(0,1600)});
   await page.screenshot({path:path.join(output,`widget-${viewport.width}-failed.png`),fullPage:true}).catch(()=>{});
   break;
  }finally{await context.close();}
 }
}finally{await browser.close();}
const after=await wallet();
const report={environment:auth.environment,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,responses,pageErrors:errors,before,after,walletRestored:JSON.stringify(before)===JSON.stringify(after),businessMocks:false,providerPayments:0};
await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed,responses,errors:errors.length,walletRestored:report.walletRestored}));
process.exitCode=report.failed||errors.length||!report.walletRestored||report.passed!==2?1:0;
