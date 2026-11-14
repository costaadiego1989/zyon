import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const auth = JSON.parse(await fs.readFile(process.env.CASHBACK_BROWSER_AUTH_FILE, 'utf8'));
const output = process.env.CASHBACK_RUNTIME_REPORT_FILE;
assert.ok(['local','homolog'].includes(auth.environment) && output);
const base = auth.baseUrl.replace(/\/$/,'').replace(/\/v1$/,'') + '/v1';
assert.equal(new URL(base).hostname, auth.environment === 'local' ? '127.0.0.1' : 'api-sandbox-8146.up.railway.app');
const checks=[];
async function run(name,fn) {
  try { await fn(); checks.push({name,pass:true}); }
  catch(e) { checks.push({name,pass:false,error:String(e.message).slice(0,600)}); }
}
async function get(route,key) {
  const r=await fetch(base+route,{redirect:'error',signal:AbortSignal.timeout(20000),headers:key?{Authorization:'Bearer '+auth.buyerTokens['qa-cashback-v1-'+key]}:{}});
  return {status:r.status,body:await r.json()};
}
for(const[key,expected]of[['specific',true],['paused',false],['disabled',false],['draft',false],['ended',false]]) {
  await run('public-'+key,async()=>{
    const {status,body}=await get('/storefront/qa-cashback-v1-'+key+'/config');
    assert.equal(status,200);assert.equal(body.merchantId,'qa-cashback-v1-'+key);assert.equal(body.cashbackEnabled,expected);
    assert.equal(body.published,undefined);assert.equal(body.wallet,undefined);assert.equal(body.balance,undefined);
  });
}
for(const[key,available,reserved]of[['specific',3500,1500],['paused',3000,0]]) {
  await run('authenticated-wallet-'+key,async()=>{
    const {status,body}=await get('/buyer/me/cashback?merchant_id=qa-cashback-v1-'+key,key);
    assert.equal(status,200);assert.equal(body.merchantId,'qa-cashback-v1-'+key);assert.equal(body.buyerId,'qa-cashback-v1-buyer-canonical');
    assert.equal(body.balance.availableCents,available);assert.equal(body.balance.reservedCents,reserved);
  });
}
await run('anonymous-wallet-denied',async()=>assert.equal((await get('/buyer/me/cashback?merchant_id=qa-cashback-v1-specific')).status,401));
await run('foreign-merchant-wallet-denied',async()=>assert.equal((await get('/buyer/me/cashback?merchant_id=qa-cashback-v1-paused','specific')).status,403));
await run('unbound-merchant-wallet-denied',async()=>assert.equal((await get('/buyer/me/cashback?merchant_id=qa-cashback-v1-nonexistent','specific')).status,403));
const report={environment:auth.environment,passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length,checks,
  actualHttp:true,businessMocks:false,financialCommands:0,providerMessages:0,payments:0};
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({environment:report.environment,passed:report.passed,failed:report.failed}));
if(report.failed)process.exitCode=1;
