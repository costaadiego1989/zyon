const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validatePublicAuthConfig,verifyAuthBundle,loadVercelPublicAuthConfig,REQUIRED_PUBLIC_AUTH_KEYS}=require('../lib/dashboard-auth-build-policy.cjs');
const valid={VITE_GOOGLE_CLIENT_ID:'synthetic.apps.googleusercontent.com',VITE_MICROSOFT_CLIENT_ID:'11111111-2222-3333-4444-555555555555',VITE_FACEBOOK_CLIENT_ID:'1234567890',VITE_TURNSTILE_SITE_KEY:'synthetic-site-key',VITE_OAUTH_REDIRECT_URI:'https://app.example.test/auth/oauth/callback',VITE_API_BASE_URL:'https://api.example.test/v1'};
test('all required public auth values survive validation without exposing extra values',()=>{
 const result=validatePublicAuthConfig({...valid,DATABASE_URL:'never-export-this'});
 assert.deepEqual(Object.keys(result).sort(),[...REQUIRED_PUBLIC_AUTH_KEYS].sort());
 assert.equal(result.DATABASE_URL,undefined);
});
for(const key of Object.keys(valid))test(`missing ${key} fails closed`,()=>{
 const config={...valid,[key]:'  '};
 assert.throws(()=>validatePublicAuthConfig(config),error=>error.message.includes(key)&&!error.message.includes('never-export-this'));
});
test('invalid HTTPS destinations fail without echoing the submitted value',()=>{
 for(const key of ['VITE_API_BASE_URL','VITE_OAUTH_REDIRECT_URI']){
  assert.throws(()=>validatePublicAuthConfig({...valid,[key]:'http://unsafe.example.test/private'}),error=>error.message.includes(key)&&!error.message.includes('unsafe.example'));
 }
});
test('the emitted bundle must contain every expected public value',()=>{
 const bundle=Object.values(valid).map(JSON.stringify).join(';');
 assert.equal(verifyAuthBundle(bundle,valid),true);
 for(const [key,value] of Object.entries(valid))assert.throws(()=>verifyAuthBundle(bundle.replace(JSON.stringify(value),'""'),valid),error=>error.message.includes(key)&&!error.message.includes(value));
});
test('the original empty-environment regression is rejected before upload',()=>{
 assert.throws(()=>verifyAuthBundle('const env={};const siteKey="";',valid));
});

test('Railway Docker builds forward every required public auth setting to Vite',()=>{
 const fs=require('node:fs');
 const path=require('node:path');
 const dockerfile=fs.readFileSync(path.join(__dirname,'../../apps/dashboard/Dockerfile'),'utf8');
 for(const key of REQUIRED_PUBLIC_AUTH_KEYS){
  assert.match(dockerfile,new RegExp('^ARG '+key+'\\s*$','m'),key+' must be accepted at build time');
  assert.ok(dockerfile.includes(key+'=$'+key),key+' must reach the Vite process');
 }
 assert.equal(/ARG (?:MICROSOFT|FACEBOOK|GOOGLE)_CLIENT_SECRET/.test(dockerfile),false);
});
test('remote loading decrypts only the explicitly public keys',async()=>{
 const calls=[];
 const envs=Object.keys(valid).map((key,i)=>({key,id:String(i),target:['production','preview'],type:'encrypted'}));
 envs.push({key:'DATABASE_URL',id:'never-read',target:['production']});
 const result=await loadVercelPublicAuthConfig(async url=>{
  calls.push(url);
  if(url.includes('?decrypt=false'))return {envs};
  const entry=envs.find(e=>url.endsWith('/'+e.id));
  assert.notEqual(entry.key,'DATABASE_URL');
  return {key:entry.key,type:'encrypted',decrypted:true,value:valid[entry.key]};
 });
 assert.deepEqual(result,valid);assert.equal(calls.length,REQUIRED_PUBLIC_AUTH_KEYS.length+1);
 assert.equal(calls.some(c=>c.includes('decrypt=true')||c.includes('never-read')),false);
});
test('remote ambiguity refuses to guess a production value',async()=>{
 await assert.rejects(()=>loadVercelPublicAuthConfig(async()=>({envs:[]})),/missing/);
});
test('the encrypted response must actually be decrypted',async()=>{
 await assert.rejects(()=>loadVercelPublicAuthConfig(async url=>url.includes('?')?{envs:[{key:'VITE_API_BASE_URL',id:'1',target:['production']}]}:{key:'VITE_API_BASE_URL',type:'encrypted',decrypted:false,value:'unusable'}),/unavailable/);
});
