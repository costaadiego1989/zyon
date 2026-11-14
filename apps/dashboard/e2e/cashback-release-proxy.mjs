import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';

const auth=JSON.parse(await fs.readFile(process.env.CASHBACK_BROWSER_AUTH_FILE,'utf8'));
const origin=process.env.CASHBACK_STOREFRONT_ORIGIN;
const sessionId=process.env.CASHBACK_EDITABLE_SESSION_ID;
const output=process.env.CASHBACK_BROWSER_REPORT;
assert.ok(['local','homolog'].includes(auth.environment)&&sessionId&&output);
assert.equal(new URL(origin).hostname,auth.environment==='local'?'127.0.0.1':'storefront-sandbox-3f42.up.railway.app');
const browser=await chromium.launch({headless:true});
let report;
try{
 const page=await browser.newPage();await page.goto(origin+'/robots.txt');
 const observations=await page.evaluate(async ({token,sessionId,operationKey})=>{
  const observations=[];
  for(const [operation,fields]of [['quote',{}],['reserve',{amount_cents:1000,idempotency_key:operationKey+'-reserve'}],['remove',{idempotency_key:operationKey+'-remove'}]]){
   const response=await fetch('/api/embed/cashback/'+operation,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({session_id:sessionId,...fields})});
   const body=await response.json();observations.push({operation,status:response.status,sessionId:body.sessionId,reservedCents:body.reservedCents,estimatedEarnCents:body.estimatedEarnCents,code:body.code??body.error});
   if(response.status!==201)break;
  }
  return observations;
 },{token:auth.tokens.embedEditableStorefront,sessionId,operationKey:'qa-cashback-v1-proxy-'+randomUUID()});
 assert.equal(observations.length,3);
 for(const o of observations){assert.equal(o.status,201,o.code);assert.equal(o.sessionId,sessionId);}
 assert.deepEqual(observations.map(o=>o.reservedCents),[0,1000,0]);
 assert.equal(observations[1].estimatedEarnCents,450);
 report={environment:auth.environment,passed:3,failed:0,actualNextOriginProxy:true,businessMocks:false,observations};
}catch(error){report={environment:auth.environment,passed:0,failed:1,error:String(error.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[REDACTED]').slice(0,1000)};}
finally{await browser.close();}
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
