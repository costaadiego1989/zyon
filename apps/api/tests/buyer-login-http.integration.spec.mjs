import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('Buyer login actual AppModule rejects invalid credentials and grants only the correct buyer',
 {timeout:SERVICE_LOCAL_TEST_MS},async t=>{
 const runtime=await createServiceTestRuntime({local:true});let prisma;
 try{
  const{PrismaClient}=await import('@prisma/client');
  const{PasswordHasher}=await import('../dist/modules/auth/domain/services/password-hasher.service.js');
  prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
  const initial=runtime.evidence();assert.equal(initial.canonicalAppModule,true);
  assert.equal(initial.authOverrides,false);assert.equal(initial.repositoryOverrides,false);assert.equal(initial.providerCalls,0);
  assert.deepEqual(initial.localProviderOverrides,[]);assert.equal(initial.localModelOverrides,undefined);
  const password='SyntheticBuyerPassword123!',email='buyer-login-'+randomUUID()+'@example.test';
  const buyer=await prisma.buyerAccount.create({data:{globalUserId:'buyer_'+randomUUID().replaceAll('-',''),email,
   passwordHash:await new PasswordHasher().hash(password),displayName:'Synthetic Service Buyer',phone:'5511999997711',cpf:'12345678909'}});
  const malformed=[];
  const [algorithm,salt,key]=buyer.passwordHash.split(':');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const aliasedLastByte=key.slice(0,-1)+alphabet[alphabet.indexOf(key.at(-1))+1];
  const malformedHashes=['not-a-password-hash','argon2id:salt:hash','scrypt::missing-salt',
   'scrypt:synthetic-salt:!',
   'scrypt:synthetic-salt:'+Buffer.alloc(1).toString('base64url'),
   'scrypt:synthetic-salt:'+Buffer.alloc(63).toString('base64url'),
   'scrypt:synthetic-salt:'+Buffer.alloc(65).toString('base64url'),
   buyer.passwordHash+'=',buyer.passwordHash+'!',buyer.passwordHash+'\n',
   `${algorithm}:${salt}:${aliasedLastByte}`];
  for(const [index,passwordHash]of malformedHashes.entries())
   malformed.push(await prisma.buyerAccount.create({data:{globalUserId:'buyer_'+randomUUID().replaceAll('-',''),
    email:'malformed-'+index+'-'+randomUUID()+'@example.test',passwordHash,displayName:'Synthetic Malformed Buyer',phone:'5511999997722'}}));
  const phoneOnly=await prisma.buyerAccount.create({data:{globalUserId:'buyer_'+randomUUID().replaceAll('-',''),
   email:'phone-'+randomUUID()+'@buyer.aacp',passwordHash:null,displayName:'+5511999997733',phone:'5511999997733'}});
  const selected=[buyer.globalUserId,...malformed.map(row=>row.globalUserId),phoneOnly.globalUserId];
  const snapshot=()=>prisma.buyerAccount.findMany({where:{globalUserId:{in:selected}},orderBy:{globalUserId:'asc'}});
  const before=await snapshot();
  const request=async(path,body,token,method='POST')=>{
   const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{
    'content-type':'application/json','x-correlation-id':randomUUID(),...(token?{authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
   return{status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  async function invalid(credentials){
   const response=await request('/buyer/login',credentials);
   assert.equal(response.status,401,JSON.stringify(response.body));
   assert.equal(response.body.code,'invalid_credentials');assert.equal(response.body.detail,'invalid_credentials');
   for(const key of ['accessToken','access_token','token','globalUserId','global_user_id'])assert.equal(Object.hasOwn(response.body,key),false,key);
   assert.equal(response.cookie,null);assert.deepEqual(await snapshot(),before);
  }
  await t.test('wrong password receives401 and no buyer credential',()=>invalid({email,password:'WrongSyntheticPassword123!'}));
  await t.test('absent account receives401 and no buyer credential',()=>invalid({email:'absent-'+randomUUID()+'@example.test',password}));
  for(const row of malformed)await t.test('malformed stored hash '+row.passwordHash+' receives401',()=>invalid({email:row.email,password}));
  await t.test('phone-only account cannot use password login',()=>invalid({email:phoneOnly.email,password}));
  await t.test('normalized correct password signs a credential accepted by the actual buyer guard',async()=>{
   const response=await request('/buyer/login',{email:'  '+email.toUpperCase()+'  ',password});
   assert.equal(response.status,201,JSON.stringify(response.body));assert.equal(response.cookie,null);
   assert.equal(response.body.globalUserId,buyer.globalUserId);assert.equal(response.body.email,email);
   assert.equal(response.body.tokenType,'Bearer');assert.equal(typeof response.body.accessToken,'string');
   assert.equal(response.body.profileComplete,true);assert.equal(response.body.name,buyer.displayName);
   const profile=await request('/buyer/me',undefined,response.body.accessToken,'GET');
   assert.equal(profile.status,200,JSON.stringify(profile.body));
   assert.equal(profile.body.global_user_id,buyer.globalUserId);assert.equal(profile.body.email,email);
   assert.equal(profile.body.display_name,buyer.displayName);assert.equal(profile.body.phone,buyer.phone);
   const token=response.body.accessToken,parts=token.split('.');
   parts[2]=(parts[2][0]==='a'?'b':'a')+parts[2].slice(1);
   const forged=await request('/buyer/me',undefined,parts.join('.'),'GET');assert.equal(forged.status,401);
   assert.equal(Object.hasOwn(forged.body,'global_user_id'),false);assert.deepEqual(await snapshot(),before);
  });
  assert.equal(runtime.evidence().providerCalls,0);assert.equal(runtime.evidence().authOverrides,false);
 }finally{
  const errors=[];try{await prisma?.$disconnect();}catch(error){errors.push(error);}
  try{await runtime.close();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'buyer_login_owned_cleanup_failed');
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
 }
});
