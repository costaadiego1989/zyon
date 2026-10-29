const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {PrismaClient}=require('@prisma/client');const path=require('node:path');const {pathToFileURL}=require('node:url');
async function main(){
 if(process.env.RAILWAY_ENVIRONMENT_NAME==='production')throw Error('production_test_forbidden');
 const databaseUrl=process.env.WHATSAPP_SESSION_TEST_DATABASE_URL;
 if(!databaseUrl)throw Error('WHATSAPP_SESSION_TEST_DATABASE_URL_required');
 const schema='wa_session_regression_'+randomUUID().replaceAll('-','');
 const admin=new PrismaClient({datasources:{db:{url:databaseUrl}},log:[]});let db;
 try{
 await admin.$executeRawUnsafe('CREATE SCHEMA '+schema);
 await admin.$executeRawUnsafe('CREATE TABLE '+schema+'.whatsapp_sessions (LIKE public.whatsapp_sessions INCLUDING ALL)');
 const url=new URL(databaseUrl);url.searchParams.set('schema',schema);url.searchParams.set('connection_limit','10');
 db=new PrismaClient({datasources:{db:{url:url.href}},log:[]});
 const {PrismaWhatsAppSessionRepository}=await import(pathToFileURL(path.resolve(__dirname,'../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-session.repository.js')).href);
 const repo=new PrismaWhatsAppSessionRepository(db);
 const input=(overrides={})=>({merchantId:'qa-merchant-a',buyerPhone:'5511999999001',deviceId:'META_CLOUD:qa-config',currentOptions:[],previousOptions:[],currentPage:0,lastActivityAt:new Date(),status:'active',conversationState:{version:1,conversationId:randomUUID(),stage:'store',history:[],revision:'',page:0,previousViews:[]},...overrides});
 const first=await repo.create(input());assert.equal(first.status,'active');console.log('PASS first contact');
 await db.whatsAppSession.update({where:{id:first.id},data:{status:'expired',checkoutSessionId:'old-checkout',currentOptions:'["stale"]',previousOptions:'["older"]',currentPage:3,postSaleContext:{stage:'awaiting_nps',buyerId:'old'},conversationState:{stage:'checkout',private:'old'}}});
 const second=await repo.create(input());assert.equal(second.id,first.id);assert.equal(second.status,'active');assert.equal(second.checkoutSessionId,undefined);assert.equal(second.postSaleContext,undefined);assert.deepEqual(second.currentOptions,[]);assert.equal(second.conversationState.stage,'store');console.log('PASS expired session renews and clears stale checkout, menu and post-sale context');
 const repeat=await repo.create(input());assert.equal(repeat.conversationState.conversationId,second.conversationState.conversationId);console.log('PASS retry preserves active conversation');
 const concurrent=await Promise.all(Array.from({length:20},()=>repo.create(input({buyerPhone:'5511999999002'}))));assert.equal(new Set(concurrent.map(x=>x.id)).size,1);assert.equal(new Set(concurrent.map(x=>x.conversationState.conversationId)).size,1);console.log('PASS 20 concurrent first contacts share one conversation');
 await repo.expire(concurrent[0].id);
 const renewed=await Promise.all(Array.from({length:20},()=>repo.create(input({buyerPhone:'5511999999002'}))));assert.equal(new Set(renewed.map(x=>x.id)).size,1);assert.equal(new Set(renewed.map(x=>x.conversationState.conversationId)).size,1);assert.notEqual(renewed[0].conversationState.conversationId,concurrent[0].conversationState.conversationId);console.log('PASS 20 concurrent renewals do not overwrite the winning state');
 const foreignTenant=await repo.create(input({merchantId:'qa-merchant-b'}));assert.notEqual(foreignTenant.id,first.id);
 const foreignDevice=await repo.create(input({deviceId:'META_CLOUD:qa-other-config'}));assert.notEqual(foreignDevice.id,first.id);
 assert.equal((await repo.findActiveByPhone('qa-merchant-a','5511999999001','META_CLOUD:qa-other-config')).id,foreignDevice.id);console.log('PASS tenant and device isolation');
 for(let i=0;i<3;i++){await repo.expire(first.id);const next=await repo.create(input());assert.equal(next.id,first.id);assert.equal(next.status,'active');}console.log('PASS repeated expiration cycles');
 console.log(JSON.stringify({databaseRegression:{passed:7,concurrentRequests:40,isolatedSchema:true,environment:process.env.RAILWAY_ENVIRONMENT_NAME||'explicit_test_database'}}));
 }finally{if(db)await db.$disconnect();if(/^wa_session_regression_[a-f0-9]{32}$/.test(schema))await admin.$executeRawUnsafe('DROP SCHEMA '+schema+' CASCADE');await admin.$disconnect();}
}
main().catch(e=>{console.error(JSON.stringify({error:e.message,code:e.code}));process.exitCode=1;});
