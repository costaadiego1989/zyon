import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const auth = JSON.parse(await fs.readFile(process.env.CASHBACK_BROWSER_AUTH_FILE, 'utf8'));
const origin = process.env.CASHBACK_STOREFRONT_ORIGIN;
const output = process.env.CASHBACK_BROWSER_REPORT_DIR;
assert.ok(['local', 'homolog'].includes(auth.environment) && output);
assert.equal(new URL(origin).hostname, auth.environment === 'local' ? '127.0.0.1' : 'storefront-sandbox-3f42.up.railway.app');
const merchantId = 'qa-cashback-v1-specific', buyerId = 'qa-cashback-v1-buyer-canonical';
const token = auth.buyerTokens[merchantId];
assert.ok(token);
const results = [], errors = [], responses = [];
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
 for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport, timezoneId: 'America/Sao_Paulo' });
  await context.addInitScript(({token,buyerId}) => {
   const email = buyerId + '@cashback.invalid', expires_at = Date.now() + 7200000;
   localStorage.setItem('zyon_buyer_token', token);
   localStorage.setItem('zyon_buyer_session', JSON.stringify({global_user_id:buyerId,email,access_token:token,expires_at}));
   localStorage.setItem('aacp_buyer_auth_session', JSON.stringify({global_user_id:buyerId,email,access_token:token,expires_at}));
  }, {token,buyerId});
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push({viewport:viewport.width,message:String(error.message).slice(0,400)}));
  page.on('response', response => {
   const u = new URL(response.url());
   if (u.origin === origin && /\/buyer\/me\/(cashback|channels\/whatsapp)/.test(u.pathname)) responses.push({viewport:viewport.width,path:u.pathname,status:response.status()});
  });
  try {
   const document = await page.goto(origin + '/store/' + merchantId);
   assert.equal(document.status(), 200);
   const refuse = page.getByRole('button', {name:'Não aceito',exact:true});
   if(await refuse.isVisible({timeout:3000}).catch(()=>false)) await refuse.click();
   const chat = page.getByRole('button', {name:/^Por chat/});
   if(await chat.isVisible({timeout:3000}).catch(()=>false)) await chat.click();
   await page.getByRole('button', {name:/^Abrir conta/}).click();
   const dialog = page.getByRole('dialog', {name:'Hub do comprador'});
   await expect(dialog).toBeVisible();
   await dialog.getByRole('tab', {name:'Fidelidade',exact:true}).click();
   const wallet = dialog.getByRole('region', {name:'Seu cashback nesta loja'});
   await expect(wallet.getByRole('heading', {name:'Seu cashback',exact:true})).toBeVisible();
   await expect(wallet).toContainText('R$ 35,00');
   await expect(wallet).toContainText('R$ 15,00');
   await expect(wallet.getByRole('heading', {name:'Extrato',exact:true})).toBeVisible();
   await expect(wallet).toContainText('Crédito da compra');
   await wallet.getByRole('button', {name:'Atualizar saldo',exact:true}).click();
   await expect(wallet.getByRole('button', {name:'Atualizar saldo',exact:true})).toBeEnabled();
   await expect(wallet).toContainText('R$ 35,00');
   await expect(wallet).not.toContainText('Não foi possível consultar');
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
   await wallet.screenshot({path:path.join(output,`buyer-wallet-${viewport.width}.png`)});
   results.push({viewport,pass:true,buyerId,merchantId,availableCents:3500,reservedCents:1500,actualNextProxy:true});
  } catch (error) {
   results.push({viewport,pass:false,error:String(error.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[REDACTED]').slice(0,1800)});
   await page.screenshot({path:path.join(output,`buyer-wallet-${viewport.width}-failed.png`),fullPage:true}).catch(()=>{});
  } finally {await context.close();}
 }
} finally {await browser.close();}
const report={environment:auth.environment,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,pageErrors:errors,responses,businessMocks:false,payments:0,messages:0};
await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed,pageErrors:errors.length,responses}));
process.exitCode=report.failed||errors.length||responses.some(r=>r.status>=400)||report.passed!==2?1:0;
