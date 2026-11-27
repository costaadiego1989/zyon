import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { CASHBACK_QA_NAMESPACE, qaId, qaMerchantId, assertQaMerchantId, validateCashbackSeedTarget } from "./cashback-validation-guard.js";
import { seedCashbackValidation, validateCashbackSeedManifest, CASHBACK_QA_BUYER, CASHBACK_QA_PREVIOUS_WA_BUYER, type CashbackSeedManifest } from "./cashback-validation-seed.js";
import { PrismaAuthRepository } from "../../src/modules/auth/infrastructure/prisma-auth.repository.js";
import { JwtService } from "../../src/modules/auth/domain/services/jwt.service.js";
import { CashbackRepository } from "../../src/modules/cashback/infrastructure/cashback.repository.js";
import { CashbackService } from "../../src/modules/cashback/application/cashback.service.js";
import { CashbackQueriesService } from "../../src/modules/cashback/application/cashback-queries.service.js";
import { CashbackAssistantReportService } from "../../src/modules/cashback/application/cashback-assistant-report.service.js";
import { cashbackConfigurationChecklist } from "../../src/modules/cashback/domain/cashback-configuration-checklist.js";

const localBase="postgresql://cashback:cashback-local-test@127.0.0.1:15433/";
const database=`cashback_seed_qa_${randomUUID().replaceAll("-","")}`;
const databaseUrl=localBase+database;
const privatePassword=randomBytes(32).toString("base64url");
const admin=new pg.Client({connectionString:localBase+"cashback"});
let prisma:PrismaClient;let manifest:CashbackSeedManifest;
const target={databaseUrl,environment:"local" as const,confirmation:CASHBACK_QA_NAMESPACE,runtimeEnvironment:{}};

test("CR-01 guard refuses implicit DATABASE_URL, production, unbound homolog and namespace escapes",()=>{
  assert.equal(validateCashbackSeedTarget(target).database,database);
  for(const input of [{...target,databaseUrl:""},{...target,environment:"production" as "local"},{...target,confirmation:"yes"},{...target,databaseUrl:localBase+"cashback"},{...target,databaseUrl:"postgresql://hidden:hidden@remote.invalid/cashback_seed_qa"},{...target,databaseUrl:localBase+"production"},{...target,runtimeEnvironment:{RAILWAY_ENVIRONMENT_NAME:"production"}},{...target,environment:"homolog" as const}])assert.throws(()=>validateCashbackSeedTarget(input),/cashback_seed_/);
  assert.doesNotThrow(()=>assertQaMerchantId(qaMerchantId("specific")));
  for(const merchant of ["merchant-real",qaId("specific-extra"),"qa-cashback-v2-specific"])assert.throws(()=>assertQaMerchantId(merchant),/outside_namespace/);
});

test("CR-01 compiled sandbox homolog is accepted with exact host/database and production runtime is denied",()=>{
  const homolog={databaseUrl:"postgresql://hidden:hidden@sandbox-db.internal/railway",environment:"homolog" as const,confirmation:CASHBACK_QA_NAMESPACE,expectedHost:"sandbox-db.internal",expectedDatabase:"railway",runtimeEnvironment:{NODE_ENV:"production",RAILWAY_ENVIRONMENT_NAME:"sandbox"}};
  assert.equal(validateCashbackSeedTarget(homolog).environment,"homolog");
  assert.throws(()=>validateCashbackSeedTarget({...homolog,expectedHost:"other.invalid"}),/target_mismatch/);
  assert.throws(()=>validateCashbackSeedTarget({...homolog,expectedDatabase:"different"}),/target_mismatch/);
  assert.throws(()=>validateCashbackSeedTarget({...homolog,runtimeEnvironment:{NODE_ENV:"production",RAILWAY_ENVIRONMENT_NAME:"production"}}),/production_runtime_forbidden/);
});

test("CR-01 database routing overrides and duplicate Prisma parameters are rejected before any connection",()=>{
  for(const query of ["host=remote.invalid","hostaddr=10.0.0.9","port=5432","dbname=other","user=other","password=hidden","service=production","options=-csearch_path=other","schema=public&schema=other","sslmode=require&sslmode=disable","socket=/tmp/pg"])
    assert.throws(()=>validateCashbackSeedTarget({...target,databaseUrl:databaseUrl+"?"+query}),/url_parameter_forbidden/);
  assert.equal(validateCashbackSeedTarget({...target,databaseUrl:databaseUrl+"?schema=public&sslmode=disable&connection_limit=3"}).schema,"public");
});

before(async()=>{
  await admin.connect();await admin.query(`CREATE DATABASE "${database}"`);
  const require=createRequire(import.meta.url),prismaCli=require.resolve("prisma/build/index.js");
  await promisify(execFile)(process.execPath,[prismaCli,"db","push","--schema","prisma/schema.prisma","--skip-generate"],{cwd:fileURLToPath(new URL("../../",import.meta.url)),env:{...process.env,DATABASE_URL:databaseUrl},maxBuffer:1024*1024});
  prisma=new PrismaClient({datasources:{db:{url:databaseUrl}}});
  const schemaClient=new pg.Client({connectionString:databaseUrl});await schemaClient.connect();
  try{await schemaClient.query(await readFile(new URL("../migrations/20260929020000_checkout_session_write_version/migration.sql",import.meta.url),"utf8"));}finally{await schemaClient.end();}
});
after(async()=>{await prisma?.$disconnect();await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);await admin.end();});

async function footprint(){
  const rows=await prisma.$queryRaw<Array<{name:string;count:bigint;amount:bigint}>>`SELECT 'ledger' AS name,count(*)::bigint AS count,COALESCE(sum(amount_cents),0)::bigint AS amount FROM cashback_ledger_entries UNION ALL SELECT 'quotes',count(*)::bigint,0::bigint FROM cashback_earning_quotes UNION ALL SELECT 'products',count(*)::bigint,0::bigint FROM products UNION ALL SELECT 'wallets',count(*)::bigint,0::bigint FROM cashback_wallets`;
  return rows.map(row=>({name:row.name,count:Number(row.count),amount:Number(row.amount)}));
}

test("CR-01 and CR-02 full-schema PostgreSQL seeds persist every scenario and repeat without duplicate money",async()=>{
  await prisma.merchant.create({data:{id:"unrelated-existing-merchant",name:"Untouched existing merchant",storeSettings:{sentinel:"preserve"}}});
  manifest=await seedCashbackValidation({...target,ownerPassword:privatePassword});
  assert.equal(manifest.merchants.length,15);assert.equal(manifest.catalog.length,60);assert.equal(manifest.cases.length,13);assert.equal(manifest.externalCalls,0);assert.equal(manifest.realProviderEvidence,false);
  const before=await footprint();const repeated=await seedCashbackValidation({...target,ownerPassword:privatePassword});
  assert.deepEqual(repeated,manifest);assert.deepEqual(await footprint(),before);
  assert.deepEqual((await prisma.merchant.findUniqueOrThrow({where:{id:"unrelated-existing-merchant"}})).storeSettings,{sentinel:"preserve"});
  const quote=manifest.cases.find(item=>item.key === "specific-100-10-5-cash")!;
  assert.equal(quote.expected.netProductsCents,7000);assert.equal(quote.expected.cashbackCents,1500);assert.equal(quote.expected.discountCents,1500);assert.ok(quote.embedNonce);
  const payment=manifest.payments.find(item=>item.merchantId === qaMerchantId("specific")&&item.orderId === null)!;assert.equal(payment.amountCents,7099);
  assert.equal(manifest.expectedWallets.refund!.availableCents,2200);assert.equal(manifest.refunds[0]!.externalRefundCents,4099);assert.equal(manifest.expectedWallets.loss!.lossCents,1000);
  const rows=await prisma.$queryRaw<Array<{canonical_buyer_id:string}>>`SELECT canonical_buyer_id FROM cashback_buyer_aliases WHERE merchant_id=${qaMerchantId("specific")} AND alias_buyer_id=${CASHBACK_QA_PREVIOUS_WA_BUYER}`;
  assert.equal(rows[0]?.canonical_buyer_id,CASHBACK_QA_BUYER);
  const users=await prisma.merchantUser.findMany({where:{merchantId:qaMerchantId("specific")}});assert.deepEqual(users.map(user=>user.role).sort(),["owner","staff"]);assert.ok(users.every(user=>user.passwordHash?.startsWith("scrypt:")));
  assert.equal((await prisma.merchantBillingSubscription.findUniqueOrThrow({where:{merchantId:qaMerchantId("isolation")}})).planKey,"starter");
  assert.equal(await prisma.campaignContactConsent.count({where:{status:"granted"}}),0);assert.equal(await prisma.postSaleMessageTemplate.count({where:{isActive:true}}),0);assert.equal(await prisma.merchantPaymentConnection.count(),0);
  assert.equal(JSON.stringify(manifest).includes(privatePassword),false);assert.equal(JSON.stringify(manifest).includes("scrypt:"),false);
  await validateCashbackSeedManifest(prisma,manifest);
});

const service=()=>new CashbackService(new CashbackRepository(prisma));
async function registrySettings(){return (await prisma.merchant.findUniqueOrThrow({where:{id:qaId("registry")}})).storeSettings as any;}
async function saveRegistry(settings:unknown){await prisma.merchant.update({where:{id:qaId("registry")},data:{storeSettings:settings as any}});}

test("experience fixtures pin real revisions and all17 empty/partial/complete checklist choices without activation",async()=>{
  const experience=manifest.experience!;
  assert.equal(experience.version,"cashback-experience-v1");
  assert.equal(experience.programs.length,3);
  for(const fixture of experience.programs){
    const program=await service().getProgram(fixture.merchantId,{includeConfigurationRevision:true});
    assert.equal(fixture.configurationRevision,program.configurationRevision);assert.match(fixture.configurationRevision,/^[a-f0-9]{64}$/);
    assert.deepEqual(fixture.checklist,cashbackConfigurationChecklist(program.draft??program.published??{}));
    assert.equal(fixture.checklist.total,17);assert.equal(fixture.status,program.status);assert.equal(fixture.programVersion,program.version);
  }
  const empty=experience.programs.find(p=>p.key==="disabled")!,partial=experience.programs.find(p=>p.key==="draft")!,complete=experience.programs.find(p=>p.key==="refund")!;
  assert.equal(empty.checklist.completed,0);assert.equal(partial.checklist.completed,4);assert.equal(complete.checklist.completed,17);
  assert.equal(partial.status,"disabled");assert.equal(partial.programVersion,0);assert.equal(partial.checklist.nextField,"buyerMonthlyEarnLimitCents");
  for(const [field,value]of [["earnRateBps",500],["minimumEarnCents",0],["maximumEarnPerOrderCents",null],["combination.allowCoupons",false]]){
    const item=partial.checklist.items.find(i=>i.field===field)!;assert.equal(item.completed,true);assert.equal(item.value,value);
  }
});

test("experience report fixtures retain exact refund cents, zero days and separate current budget scope",async()=>{
  const fixture=manifest.experience!.report;
  const queries=new CashbackQueriesService(new CashbackRepository(prisma),service());
  const report=await new CashbackAssistantReportService(queries).read(fixture.merchantId,fixture.period);
  assert.equal(report.currency,"BRL");assert.equal(report.timeZone,"America/Sao_Paulo");
  assert.equal(report.metrics.grantedCents,400);assert.equal(report.metrics.redeemedCents,2000);assert.equal(report.metrics.restoredCents,1000);assert.equal(report.metrics.reversedCents,200);
  assert.equal(report.metrics.availableCents,2200);assert.equal(report.metrics.reservedCents,0);assert.equal(report.metrics.pendingCents,0);
  assert.deepEqual(report.metrics.dailyMovements,fixture.dailyMovements);
  assert.ok(fixture.dailyMovements.length>=7);assert.ok(fixture.dailyMovements.some(d=>d.grantedCents===0&&d.redeemedCents===0));
  assert.equal(fixture.dailyMovements.reduce((n,d)=>n+d.grantedCents,0),400);assert.equal(fixture.dailyMovements.reduce((n,d)=>n+d.redeemedCents,0),2000);
  assert.equal(report.budgetMonth,new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit"}).format(new Date(report.metrics.asOf)));
  assert.equal(report.metrics.budgetIssuedCents,400);assert.equal(report.metrics.budgetCommittedCents,0);assert.equal(report.metrics.budgetLimitCents,100000);
});

test("historical report periods retain current stock and budget while movement dates stay historical",async()=>{
  const fixture=manifest.experience!.report,queries=new CashbackQueriesService(new CashbackRepository(prisma),service());
  const report=await new CashbackAssistantReportService(queries).read(fixture.merchantId,fixture.historicalPeriod);
  assert.ok(report.metrics.to<manifest.referenceAt);assert.equal(report.metrics.grantedCents,0);assert.equal(report.metrics.redeemedCents,0);
  assert.ok(report.metrics.dailyMovements!.length>=4);assert.ok(report.metrics.dailyMovements!.every(d=>d.grantedCents===0&&d.redeemedCents===0));
  assert.equal(report.metrics.availableCents,2200);assert.equal(report.metrics.budgetIssuedCents,400);assert.equal(report.metrics.budgetCommittedCents,0);assert.equal(report.metrics.budgetLimitCents,100000);
  assert.ok(report.metrics.asOf>report.metrics.to);assert.equal(report.budgetMonth,fixture.budget.period);
});

test("old completed markers receive experience fixtures and retain later program versions without duplicate ledger",async()=>{
  const original=await registrySettings(),old=structuredClone(original),before=await footprint();
  delete old.cashbackQaSeed.manifest.experience;old.cashbackQaSeed.steps=old.cashbackQaSeed.steps.filter((s:string)=>s!=="cashback-experience-v1");
  await saveRegistry(old);
  await service().publishProgram(qaMerchantId("paused"),qaId("owner-paused"),{requireCombination:true});
  await service().publishProgram(qaMerchantId("paused"),qaId("owner-paused"),{requireCombination:true});
  await service().pauseProgram(qaMerchantId("paused"),qaId("owner-paused"));
  const current=await service().getProgram(qaMerchantId("paused"),{includeConfigurationRevision:true});
  assert.equal(current.version,3);assert.equal(current.status,"paused");
  const upgraded=await seedCashbackValidation({...target,ownerPassword:privatePassword});
  assert.equal(upgraded.experience!.version,"cashback-experience-v1");assert.deepEqual(await footprint(),before);
  assert.deepEqual(await service().getProgram(qaMerchantId("paused"),{includeConfigurationRevision:true}),current);
  assert.deepEqual(await seedCashbackValidation({...target,ownerPassword:privatePassword}),upgraded);
  assert.deepEqual(await footprint(),before);manifest=upgraded;
});

test("replay deactivates newly added QA templates despite the old completed catalog step and preserves foreign templates",async()=>{
  const before=await footprint(),settings=await registrySettings();assert.ok(settings.cashbackQaSeed.steps.includes("communications-catalog-v2"));
  const foreign="unrelated-existing-merchant";
  await prisma.postSaleMessageTemplate.create({data:{id:"foreign-template-sentinel",merchantId:foreign,type:"campaign_ready",channel:"whatsapp",name:"Foreign active",body:"Preserve",isActive:true}});
  await prisma.postSaleMessageTemplate.updateMany({where:{merchantId:{in:[qaId("registry"),...manifest.merchants.map(m=>m.id)]},type:{in:["buyer_whatsapp_link_otp","campaign_ready"]}},data:{isActive:true}});
  assert.ok(await prisma.postSaleMessageTemplate.count({where:{merchantId:qaMerchantId("draft"),isActive:true}}));
  await seedCashbackValidation({...target,ownerPassword:privatePassword});
  assert.equal(await prisma.postSaleMessageTemplate.count({where:{merchantId:{in:[qaId("registry"),...manifest.merchants.map(m=>m.id)]},isActive:true}}),0);
  assert.equal((await prisma.postSaleMessageTemplate.findUniqueOrThrow({where:{id:"foreign-template-sentinel"}})).isActive,true);assert.deepEqual(await footprint(),before);
});

test("tampered persisted manifest rejects every foreign or suffix tenant before template/program/wallet writes",async()=>{
  const original=await registrySettings(),foreign="unrelated-existing-merchant";
  await service().saveDraft(foreign,{earnRateBps:1234},"foreign-owner");
  await service().adjustWallet(foreign,"foreign-buyer",{amountCents:777,reason:"Foreign sentinel preserve",idempotencyKey:"foreign-sentinel",expiryDays:null},"foreign-owner");
  const snapshot=async()=>({program:await service().getProgram(foreign,{includeConfigurationRevision:true}),wallet:await service().wallet(foreign,"foreign-buyer"),template:await prisma.postSaleMessageTemplate.findUniqueOrThrow({where:{id:"foreign-template-sentinel"}}),footprint:await footprint()});
  const before=await snapshot();
  const patches:Array<(m:any,id:string)=>void>=[
    (m,id)=>{m.merchants[0].id=id;},(m,id)=>{m.cases[0].merchantId=id;},(m,id)=>{m.catalog[0].merchantId=id;},(m,id)=>{m.payments[0].merchantId=id;},(m,id)=>{m.refunds[0].merchantId=id;},(m,id)=>{m.httpChecks[0].merchantId=id;},
    (m,id)=>{m.expectedWallets[id]={availableCents:777};},(m,id)=>{m.expectedMetrics[id]={availableCents:777};},(m,id)=>{m.expectedReconciliationIssues[id]=[];},(m,id)=>{m.experience.programs[0].merchantId=id;},(m,id)=>{m.experience.report.merchantId=id;},(m,id)=>{m.experience.expiry.merchantId=id;}
  ];
  try{for(const id of [foreign,qaId("specific-extra")])for(const patch of patches){const bad=structuredClone(original);patch(bad.cashbackQaSeed.manifest,id);await saveRegistry(bad);await assert.rejects(seedCashbackValidation({...target,ownerPassword:privatePassword}),/cashback_seed_manifest_/);assert.deepEqual(await snapshot(),before);}}
  finally{await saveRegistry(original);}
});

test("persisted manifest requires matching target/environment/version and each exact merchant key once",async()=>{
  const original=await registrySettings(),before=await footprint();
  const patches=[(m:any)=>{m.targetHash="0".repeat(64);},(m:any)=>{m.environment="homolog";},(m:any)=>{m.version="qa-cashback-v2";},(m:any)=>{m.markerMerchantId="unrelated-existing-merchant";},(m:any)=>{m.merchants[0]=m.merchants[1];},(m:any)=>{m.merchants.pop();},(m:any)=>{m.merchants[0].key="specific-extra";}];
  try{for(const patch of patches){const bad=structuredClone(original);patch(bad.cashbackQaSeed.manifest);await saveRegistry(bad);await assert.rejects(seedCashbackValidation({...target,ownerPassword:privatePassword}),/cashback_seed_manifest_/);assert.deepEqual(await footprint(),before);}}
  finally{await saveRegistry(original);}
});

test("CR-01 rerun detects tampered QA data instead of resetting or crediting it again",async()=>{
  assert.ok(manifest);const before=await footprint();
  await prisma.campaignContactConsent.updateMany({where:{merchantId:qaMerchantId("specific"),channel:"email"},data:{status:"granted"}});
  await assert.rejects(seedCashbackValidation({...target,ownerPassword:privatePassword}),/contact_consent_not_disabled/);
  assert.deepEqual(await footprint(),before);
  await prisma.campaignContactConsent.updateMany({where:{merchantId:qaMerchantId("specific")},data:{status:"revoked"}});
  const isolationSettings=(await prisma.merchant.findUniqueOrThrow({where:{id:qaMerchantId("isolation")}})).storeSettings;
  await prisma.merchant.update({where:{id:qaMerchantId("isolation")},data:{storeSettings:{qaSeedVersion:"not-owned"}}});
  await assert.rejects(seedCashbackValidation({...target,ownerPassword:privatePassword}),/merchant_collision/);
  assert.deepEqual(await footprint(),before);
  await prisma.merchant.update({where:{id:qaMerchantId("isolation")},data:{storeSettings:isolationSettings!}});
});

test("CR-02 seeded owner and staff issue real durable JWT sessions with matching persisted memberships",async()=>{
  const repository=new PrismaAuthRepository(prisma),jwt=new JwtService(randomBytes(40).toString("base64url"),120,repository);
  for(const id of [qaId("owner-specific"),qaId("staff-specific")]){
    const user=await prisma.merchantUser.findUniqueOrThrow({where:{id}}),role=user.role as "owner"|"staff";
    const principal={userId:user.id,merchantId:user.merchantId,email:user.email,role};
    const token=await jwt.issue(principal,user.authVersion),authenticated=await jwt.authenticate(token);
    assert.equal(authenticated.userId,id);assert.equal(authenticated.role,role);assert.equal(authenticated.merchantId,qaMerchantId("specific"));
    const payload=JSON.parse(Buffer.from(token.split(".")[1]!,"base64url").toString()),session=await prisma.merchantAuthSession.findUniqueOrThrow({where:{id:payload.jti}});
    assert.equal(session.userId,id);assert.equal(session.authVersion,user.authVersion);assert.equal(session.merchantId,qaMerchantId("specific"));
    await jwt.revoke(token);await assert.rejects(jwt.authenticate(token),/session_invalid/);
  }
});


test("aged replay applies the declared3day expiry policy without changing original immediate expectations",async(t)=>{
  assert.deepEqual(manifest.expectedWallets.expiry,{availableCents:500,expiredCents:500});
  assert.equal(manifest.expectedMetrics.expiry!.availableCents,500);assert.equal(manifest.expectedMetrics.expiry!.expiredCents,500);
  assert.deepEqual(manifest.experience!.expiry,{merchantId:qaMerchantId("expiry"),expiresAt:new Date(Date.parse(manifest.referenceAt)+2*86400000).toISOString(),before:{availableCents:500,expiredCents:500},after:{availableCents:0,expiredCents:1000}});
  const before=await footprint();t.mock.timers.enable({apis:["Date"],now:new Date(manifest.referenceAt).getTime()+3*86400000});
  try{
    const replay=await seedCashbackValidation({...target,ownerPassword:privatePassword});
    assert.deepEqual(replay.expectedWallets.expiry,{availableCents:500,expiredCents:500});
    const balance=(await service().wallet(qaMerchantId("expiry"),CASHBACK_QA_BUYER)).balance;
    assert.equal(balance.availableCents,0);assert.equal(balance.expiredCents,1000);
    const after=await footprint();assert.equal(after.find(r=>r.name==="ledger")!.count,before.find(r=>r.name==="ledger")!.count+1);
    const entries=await prisma.$queryRaw<Array<{amount_cents:number}>>`SELECT amount_cents FROM cashback_ledger_entries WHERE merchant_id=${qaMerchantId("expiry")} AND type='expire'`;
    assert.deepEqual(entries.map(r=>Number(r.amount_cents)).sort(),[500,500]);
    await seedCashbackValidation({...target,ownerPassword:privatePassword});assert.deepEqual(await footprint(),after);
  }finally{t.mock.timers.reset();}
});
