const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm'),ts=require('typescript');
const routePath=path.resolve(__dirname,'../src/app/api/v1/[...path]/route.ts');
const compiled=ts.transpileModule(fs.readFileSync(routePath,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(status=200,bytes=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x80,0xfe]),contentType='image/jpeg'){
 const calls=[],module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,require:id=>id==='next/server'?require(id):{storefrontRequestOrigin:()=> 'https://store.fixture.invalid'},URL,Headers,process:{env:{AACP_API_URL:'https://api.fixture.invalid',AACP_SERVICE_API_KEY:''}},fetch:async(url,init)=>{calls.push({url,...init});return new Response(bytes,{status,headers:{'Content-Type':contentType}})}});
 return {calls,invoke(method='GET',segments=['support','attachments','att_fixture_photo'],query='?access_token=fixture-signed-photo',authorization){const request=new Request('https://store.fixture.invalid/api/v1/'+segments.join('/')+query,{method,headers:authorization?{Authorization:authorization}:{}});request.nextUrl=new URL(request.url);return module.exports[method](request,{params:Promise.resolve({path:segments})});}};
}
test('signed photo read preserves the binary image and private response headers',async()=>{
 const route=fixture(),r=await route.invoke();assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x80,0xfe]));assert.equal(r.headers.get('content-type'),'image/jpeg');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(route.calls[0].url,'https://api.fixture.invalid/v1/support/attachments/att_fixture_photo?access_token=fixture-signed-photo');assert.equal(route.calls[0].cache,'no-store');
});
test('attachment writes and merchant support routes remain blocked',async()=>{
 for(const method of ['POST','PATCH','PUT','DELETE']){const route=fixture();assert.equal((await route.invoke(method)).status,403);assert.equal(route.calls.length,0);}
 for(const segments of [['support','tickets'],['support','attachments'],['support','attachments','att_fixture_photo','extra']]){const route=fixture();assert.equal((await route.invoke('GET',segments)).status,403);assert.equal(route.calls.length,0);}
});
test('invalid photo capability keeps the API denial and buyer JSON remains intact',async()=>{
 const denial=fixture(404,Buffer.from('{"code":"attachment_not_found"}'),'application/json'),r=await denial.invoke();assert.equal(r.status,404);assert.deepEqual(await r.json(),{code:'attachment_not_found'});
 const body={message:'Solicitação de troca'},route=fixture(200,Buffer.from(JSON.stringify(body)),'application/json'),buyer=await route.invoke('GET',['buyer','support','tickets'],'','Bearer fixture-buyer');assert.deepEqual(await buyer.json(),body);assert.equal(route.calls[0].headers.Authorization,'Bearer fixture-buyer');
});
