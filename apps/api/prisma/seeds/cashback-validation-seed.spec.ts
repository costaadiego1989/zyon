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

test("CR-01 rerun detects tampered QA data instead of resetting or crediting it again",async()=>{
  assert.ok(manifest);const before=await footprint();
  await prisma.campaignContactConsent.updateMany({where:{merchantId:qaMerchantId("specific"),channel:"email"},data:{status:"granted"}});
  await assert.rejects(seedCashbackValidation({...target,ownerPassword:privatePassword}),/contact_consent_not_disabled/);
  assert.deepEqual(await footprint(),before);
  await prisma.campaignContactConsent.updateMany({where:{merchantId:qaMerchantId("specific")},data:{status:"revoked"}});
  await prisma.merchant.update({where:{id:qaMerchantId("isolation")},data:{storeSettings:{qaSeedVersion:"not-owned"}}});
  await assert.rejects(seedCashbackValidation({...target,ownerPassword:privatePassword}),/merchant_collision/);
  assert.deepEqual(await footprint(),before);
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
