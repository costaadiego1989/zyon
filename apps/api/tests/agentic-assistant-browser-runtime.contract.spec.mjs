import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const loader='data:text/javascript,'+encodeURIComponent("import {register} from 'node:module';import {pathToFileURL} from 'node:url';register('./tests/ready-prod-loader.mjs',pathToFileURL('./'));");
const start=env=>{const child=spawn(process.execPath,['--import',loader,'./tests/agentic-assistant-browser-runtime.ts'],{cwd:root,env:{...process.env,NODE_ENV:'test',...env},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>{output=(output+b).slice(-32000);});child.stderr.on('data',b=>{output=(output+b).slice(-32000);});return{child,output:()=>output,exited:new Promise(resolve=>child.once('exit',code=>resolve(code)))};};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('ADAS-48 browser runtime refuses missing nonce before initializing any database',{timeout:30000},async()=>{
  const f=start({AGENTIC_TEST_NONCE:'',DATABASE_URL:'postgresql://forbidden.invalid/never'});assert.notEqual(await f.exited,0);assert.match(f.output(),/agentic_test_nonce_required/);assert.doesNotMatch(f.output(),/ECONNREFUSED|ENOTFOUND|ready/);
});
test('ADAS-54 browser witness runs actual cookie auth PG history RAG metering and cross-store denial',{timeout:180000},async()=>{
  const nonce=randomBytes(32).toString('hex'),base='http://127.0.0.1:3039',headers={'x-agentic-test-nonce':nonce,'content-type':'application/json'};const f=start({AGENTIC_TEST_NONCE:nonce,AGENTIC_TEST_PORT:'3039',DATABASE_URL:'postgresql://forbidden.invalid/never'});let shutdown=false;
  try{
    let ready=false;for(let i=0;i<400;i++){try{ready=(await fetch(base+'/__test/health')).ok;}catch{}if(ready||f.child.exitCode!==null)break;await pause(200);}assert.ok(ready,f.output());
    assert.equal((await fetch(base+'/v1/merchant-assistant/contexts/meta-ads/thread')).status,401);
    assert.equal((await fetch(base+'/__test/facts')).status,403);
    const login=await fetch(base+'/__test/login',{method:'POST',headers,body:JSON.stringify({store:'store-a'})});assert.equal(login.status,200,f.output());const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(cookie,/aacp_access_token=ey/);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
    const scopeHeaders={cookie,origin:'http://127.0.0.1:5179','content-type':'application/json'};
    const initial=await fetch(base+'/v1/merchant-assistant/contexts/meta-ads/thread',{headers:scopeHeaders});assert.equal(initial.status,200);const history=await initial.json();assert.equal(history.context.id,'meta-ads');assert.deepEqual(history.turns,[]);
    const sent=await fetch(base+`/v1/merchant-assistant/contexts/meta-ads/threads/${history.id}/turns`,{method:'POST',headers:scopeHeaders,body:JSON.stringify({message:'Como adiciono fundos para pagar os anúncios?',expectedRevision:0,idempotencyKey:'witness-turn'})});assert.equal(sent.status,202,await sent.clone().text());
    let completed;for(let i=0;i<250;i++){const value=await (await fetch(base+'/v1/merchant-assistant/contexts/meta-ads/thread',{headers:scopeHeaders})).json();completed=value.turns?.[0];if(completed?.status==='completed')break;if(completed?.status==='failed'||completed?.status==='unknown')break;await pause(100);}assert.equal(completed?.status,'completed',f.output());assert.match(completed.reply,/Meta/);assert.ok(completed.references.length>0);
    const facts=await (await fetch(base+'/__test/facts',{headers})).json();assert.equal(facts.databaseHost,'127.0.0.1');assert.equal(facts.threads,1);assert.equal(facts.turns,1);assert.ok(facts.authSessions>=1);assert.ok(facts.confirmedAiCostMicros>0);assert.ok(facts.retrievedReferenceIds.length>0);assert.equal(facts.writes.length,0);assert.equal(facts.images,0);
    assert.ok(facts.governanceDecisions>0);
    const saved=await fetch(base+'/v1/meta-ads-agent/campaigns',{method:'POST',headers:scopeHeaders,body:JSON.stringify({draft:{name:'Camisa da loja',destination:'store',priority:'roas',variantIds:['variant-a'],country:'BR',mediaIds:[],headline:'Camisa',primaryText:'Conheça nossa camisa',budget:{currency:'BRL',cadence:'lifetime',amountCents:10000,startsAt:'2026-11-16T12:00:00Z',endsAt:'2026-11-23T12:00:00Z'}},idempotencyKey:'native-image-campaign'})});assert.equal(saved.status,201,await saved.clone().text());const campaign=await saved.json();
    const generated=await fetch(base+`/v1/meta-ads-agent/campaigns/${campaign.id}/generations`,{method:'POST',headers:scopeHeaders,body:JSON.stringify({imageCount:1,idempotencyKey:'native-image-witness'})});assert.equal(generated.status,202,await generated.clone().text());const generation=await generated.json();let image;
    for(let i=0;i<150;i++){const state=await(await fetch(base+'/v1/meta-ads-agent',{headers:scopeHeaders})).json();image=state.generations?.find(g=>g.id===generation.id);if(image&&!['reserved','running'].includes(image.status))break;await pause(100);}assert.equal(image?.status,'succeeded',JSON.stringify(image));const after=await(await fetch(base+'/__test/facts',{headers})).json();assert.equal(after.images,1);assert.equal(after.reviewCalls,1);assert.equal(after.states.find(s=>s.merchantId==='store-a').credits.monthlyAvailable,29);
    const other=await fetch(base+'/__test/login',{method:'POST',headers,body:JSON.stringify({store:'store-b'})});assert.equal(other.status,200);const otherCookie=other.headers.get('set-cookie').split(';')[0];const cross=await fetch(base+`/v1/merchant-assistant/contexts/meta-ads/threads/${history.id}/turns`,{headers:{cookie:otherCookie}});assert.ok([403,404].includes(cross.status));assert.doesNotMatch(await cross.text(),/Como adiciono fundos/);
    const stop=await fetch(base+'/__test/shutdown',{method:'POST',headers,body:'{}'});assert.equal(stop.status,200);shutdown=true;assert.equal(await f.exited,0,f.output());
  }finally{if(!shutdown){try{await fetch(base+'/__test/shutdown',{method:'POST',headers,body:'{}'});}catch{}const closed=await Promise.race([f.exited,pause(10000).then(()=>false)]);if(closed===false)f.child.kill();}}
});
