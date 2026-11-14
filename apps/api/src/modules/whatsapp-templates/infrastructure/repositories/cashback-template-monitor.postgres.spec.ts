import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaRecoveryTemplateLifecycleRepository } from "./prisma-recovery-template-lifecycle.repository.js";
import { RecoveryTemplateLifecycleUseCase } from "../../application/use-cases/recovery-template-lifecycle.use-case.js";
import { RecoveryTemplateMonitorJob } from "../recovery-template-monitor.job.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";

test("CASH actual monitor completes all29 types for one merchant, keeps cash inactive and retries without loss",{timeout:120000},async()=>{
  const base="postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback";
  const schema="cashback_template_"+randomUUID().replaceAll("-","");
  const require=createRequire(import.meta.url),pg=require("pg")as {Client:new(input:{connectionString:string})=>{
    connect():Promise<void>;query(sql:string):Promise<unknown>;end():Promise<void>}};
  const admin=new pg.Client({connectionString:base});let prisma:PrismaClient|undefined;
  await admin.connect();await admin.query(`CREATE SCHEMA "${schema}"`);
  try{
    const cli=require.resolve("prisma/build/index.js"),url=base+"?schema="+schema;
    await promisify(execFile)(process.execPath,[cli,"db","push","--schema","prisma/schema.prisma","--skip-generate"],
      {cwd:fileURLToPath(new URL("../../../../../",import.meta.url)),env:{...process.env,DATABASE_URL:url},maxBuffer:1024*1024});
    prisma=new PrismaClient({datasources:{db:{url}}});
    const merchantId="qa-template-"+randomUUID();await prisma.merchant.create({data:{id:merchantId,name:"Synthetic template QA"}});
    const repo=new PrismaRecoveryTemplateLifecycleRepository(prisma);
    const noProvider=async()=>assert.fail("Monitor without connected account must never contact a provider");
    const lifecycle=new RecoveryTemplateLifecycleUseCase(repo,{createAndSubmit:noProvider,syncStatus:noProvider}as never,
      {findByMerchantId:async()=>null}as never);
    const monitor=new RecoveryTemplateMonitorJob(repo,lifecycle);
    await monitor.runOnce();
    const rows=await prisma.postSaleMessageTemplate.findMany({where:{merchantId},orderBy:[{type:"asc"},{channel:"asc"}]});
    assert.equal(rows.length,58);assert.equal(new Set(rows.map(row=>row.type)).size,29);
    for(const type of WHATSAPP_TEMPLATE_TYPES){
      const pair=rows.filter(row=>row.type===type);assert.deepEqual(pair.map(row=>row.channel),["email","whatsapp"]);
      if(type.startsWith("cashback_")){
        assert.ok(pair.every(row=>row.isActive===false));
        assert.equal(pair.find(row=>row.channel==="whatsapp")!.metaCategory,"MARKETING");
      }else assert.ok(pair.every(row=>row.isActive===true),type);
    }
    const legacy=rows.find(row=>row.type==="order_confirmation"&&row.channel==="email")!;
    await prisma.postSaleMessageTemplate.update({where:{id:legacy.id},data:{body:"Merchant-authored message retained"}});
    const before=await prisma.postSaleMessageTemplate.findMany({where:{merchantId},orderBy:{id:"asc"}});
    await monitor.runOnce();
    assert.deepEqual(await prisma.postSaleMessageTemplate.findMany({where:{merchantId},orderBy:{id:"asc"}}),before);
  }finally{
    await prisma?.$disconnect();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
  }
});
