import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {PrismaClient} from "@prisma/client";
import {TenantContextService} from "../../../shared/tenant/tenant-context.service.js";
import {AiGovernanceService} from "../ai-governance.service.js";
import {AiMeteringService} from "../../ai-metering/ai-metering.service.js";
import {AiCostsReader} from "../../ai-metering/ai-costs.reader.js";
import {meteredAiFetch,withAiMetering} from "../../../shared/ai-metering.js";
import {withAiAutomation} from "../../../shared/ai-automation.js";
import {MerchantAiGovernanceController} from "../ai-governance.controller.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {Reflector} from "@nestjs/core";
import {PlatformAiGovernanceController} from "../ai-governance.controller.js";
import {hasPlatformPermission} from "../../platform-control/domain/platform-operator.js";

test("governance: real persistence, dispatch admission, tasks and tenant isolation",async t=>{
  const database=process.env.AI_GOVERNANCE_TEST_DATABASE_URL;
  assert.ok(database,"AI_GOVERNANCE_TEST_DATABASE_URL is required; integration cannot silently skip");
  const target=new URL(database);
  assert.ok(["127.0.0.1","localhost"].includes(target.hostname)&&target.pathname.startsWith("/support_test"),"isolated local test database required");
  const db=new PrismaClient({datasources:{db:{url:database}}}),tenant=new TenantContextService(),gov=new AiGovernanceService(db,tenant);
  const meter=new AiMeteringService(db,tenant,null,gov),reader=new AiCostsReader(db);
  const tag="governance_"+randomUUID().replaceAll("-",""),a=tag+"_a",b=tag+"_b";
  let dispatches=0;
  const transport:typeof fetch=async()=>{dispatches++;return new Response(JSON.stringify({id:randomUUID(),model:"gpt-4o-mini",usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}}),{status:200,headers:{"Content-Type":"application/json"}});};
  const call=(merchantId:string,source="product_seo")=>withAiMetering({merchantId,source},()=>meteredAiFetch(source,transport)("https://api.openai.com/v1/chat/completions",{method:"POST",body:JSON.stringify({model:"gpt-4o-mini"})}));
  let actorId="";
  try{
    await db.merchant.createMany({data:[{id:a,name:"Synthetic A"},{id:b,name:"Synthetic B"}]});
    const user=await db.merchantUser.create({data:{merchantId:a,email:tag+"@example.test",role:"owner"}});actorId=user.id;
    meter.onModuleInit();
    await t.test("concurrent tenants persist separate physical attempts",async()=>{
      await Promise.all([call(a),call(b)]);
      assert.equal(await db.aiUsageEvent.count({where:{merchantId:a}}),1);assert.equal(await db.aiUsageEvent.count({where:{merchantId:b}}),1);
      assert.equal(await db.aiGovernanceDecision.count({where:{merchantId:a,allowed:true}}),1);
    });
    await t.test("unregistered models are denied before dispatch",async()=>{
      const before=dispatches;
      await assert.rejects(withAiMetering({merchantId:a,source:"product_seo"},()=>meteredAiFetch("product_seo",transport)("https://api.openai.com/v1/chat/completions",{body:JSON.stringify({model:"unapproved-paid-model"})})),/ai_access_denied/);
      assert.equal(dispatches,before);assert.equal(await db.aiUsageEvent.count({where:{merchantId:a,model:"unapproved-paid-model"}}),0);
    });
    await t.test("policy updates are versioned and stale editors cannot overwrite",async()=>{
      await gov.savePolicy(a,actorId,{version:0,grants:[{kind:"model",resource:"openai:gpt-4o-mini",roles:["owner"],sources:["product_seo"]}]});
      await assert.rejects(gov.savePolicy(a,actorId,{version:0,grants:[]}),/ai_policy_version_changed/);
      assert.equal(await db.aiGovernancePolicyRevision.count({where:{merchantId:a}}),1);
    });
    await t.test("buyer cannot spend an owner-only grant; allowed owner can",async()=>{
      const before=dispatches;await assert.rejects(call(a),/ai_access_denied/);assert.equal(dispatches,before);
      await tenant.run({merchantId:a,userId:actorId,role:"owner"},()=>call(a));
      assert.equal(dispatches,before+1);
    });
    await t.test("cross-tenant server context is rejected before any provider request",async()=>{
      const before=dispatches;
      await assert.rejects(tenant.run({merchantId:a,userId:actorId,role:"owner"},()=>call(b)),/ai_tenant_context_mismatch/);assert.equal(dispatches,before);
    });
    await t.test("MCP tools obey role and resource rules without a model charge",async()=>{
      await assert.rejects(gov.authorize({merchantId:a,source:"mcp"},"tool","aacp_search_catalog"),/ai_access_denied/);
      await gov.savePolicy(b,actorId,{version:0,grants:[{kind:"tool",resource:"aacp_search_catalog",roles:["service"],sources:["mcp"]}]});
      assert.equal((await gov.authorize({merchantId:b,source:"mcp"},"tool","aacp_search_catalog")).actorRole,"service");
      await assert.rejects(gov.authorize({merchantId:b,source:"mcp"},"tool","dump_tenants"),/ai_access_denied/);
    });
    await t.test("team snapshots apply only to future calls and tenant members",async()=>{
      await assert.rejects(gov.assignTeam(a,actorId,{principalId:"foreign-actor",teamId:"catalog"}),/ai_team_actor_not_in_tenant/);
      await gov.assignTeam(a,actorId,{principalId:actorId,teamId:"catalog"});
      await tenant.run({merchantId:a,userId:actorId,role:"owner"},()=>call(a));
      const rows=await db.aiUsageEvent.findMany({where:{merchantId:a}});
      assert(rows.some(r=>r.teamId==="catalog"&&r.actorId===actorId));assert(rows.some(r=>r.teamId===null));
    });
    await t.test("MCP catalog returns only active public fields for the authenticated tenant",async()=>{
      await db.product.create({data:{merchantId:b,name:"Synthetic shared book",variants:{create:{sku:"b-book",price:{create:{basePriceInCents:1200,costInCents:500}}}}}});
      await db.product.create({data:{merchantId:a,name:"Synthetic shared book",variants:{create:{sku:"a-book",price:{create:{basePriceInCents:9999}}}}}});
      const result=await gov.toolCatalog(b,"shared",10);
      assert.equal(result.products.length,1);assert.equal(result.products[0].sku,"b-book");
      assert.equal(result.products[0].priceCents,1200);assert.equal("costInCents" in result.products[0],false);
      await assert.rejects(gov.toolCatalog(a,"shared",10),/ai_access_denied/);
      await assert.rejects(gov.toolCatalog(b,"shared",10000),/ai_catalog_invalid_query/);
    });
    await t.test("task count is independent of model attempt count; baseline is frozen",async()=>{
      await gov.baseline(a,actorId,{taskType:"product_seo",humanMs:120000,sampleSize:10});
      await tenant.run({merchantId:a,userId:actorId,role:"owner"},()=>withAiAutomation({merchantId:a,source:"product_seo",taskType:"product_seo"},async()=>{await call(a);await call(a);return {valid:true};}));
      const task=await db.aiAutomationTask.findFirstOrThrow({where:{merchantId:a}});
      assert.equal(task.status,"succeeded");assert.equal(task.baselineHumanMs,120000);assert.equal(task.observedHumanMs,null);
      assert.equal(await db.aiUsageEvent.count({where:{taskId:task.id}}),2);
      await gov.baseline(a,actorId,{taskType:"product_seo",humanMs:180000,sampleSize:20});
      assert.equal((await db.aiAutomationTask.findUniqueOrThrow({where:{id:task.id}})).baselineHumanMs,120000);
      const unobserved=await gov.report({merchantId:a});assert.equal(unobserved.tasks.estimatedHumanMsAvoided,null);
      await assert.rejects(gov.observeHumanTime(b,actorId,task.id,0),/ai_task_unavailable/);
      await gov.observeHumanTime(a,actorId,task.id,30000);
      await assert.rejects(gov.observeHumanTime(a,actorId,task.id,0),/already_observed/);
      const report=await gov.report({merchantId:a,teamId:"catalog"});assert.equal(report.tasks.completed,"1");assert.equal(report.tasks.estimatedHumanMsAvoided,"90000");
      assert.equal(report.recentTasks.length,1);
    });
    await t.test("failure remains failure; missing baseline is unavailable rather than zero",async()=>{
      await assert.rejects(tenant.run({merchantId:a,userId:actorId,role:"owner"},()=>withAiAutomation({merchantId:a,source:"product_seo",taskType:"store_seo"},async()=>{throw Error("synthetic_failure");})),/synthetic_failure/);
      const task=await db.aiAutomationTask.findFirstOrThrow({where:{merchantId:a,taskType:"store_seo"}});
      assert.equal(task.status,"failed");assert.equal(task.baselineHumanMs,null);
    });
    await t.test("task completion failure never repeats the paid work",async()=>{
      const original=gov.finishTask.bind(gov);let executions=0;
      gov.finishTask=async()=>{};
      try{await tenant.run({merchantId:a,userId:actorId,role:"owner"},()=>withAiAutomation({merchantId:a,source:"product_seo",taskType:"product_seo"},async()=>{executions++;return "generated";}));}
      finally{gov.finishTask=original;}
      assert.equal(executions,1);assert.equal(await db.aiAutomationTask.count({where:{merchantId:a,status:"pending"}}),1);
    });
    await t.test("merchant controller overwrites a forged tenant filter",async()=>{
      const controller=new MerchantAiGovernanceController(gov);
      const report=await controller.report({user:{merchantId:a,userId:actorId,role:"owner"}},{merchantId:b});
      assert(report.breakdown.every((row:any)=>row.merchantId===a));
    });
    await t.test("currency-preserving report and CSV reject spreadsheet formulas",async()=>{
      const report=await reader.report({merchantId:a});
      assert.equal(report.summary.calls,String(await db.aiUsageEvent.count({where:{merchantId:a}})));
      assert(report.summary.costs.every((row:any)=>row.currency==="USD"));
      const events=await reader.events({merchantId:a});assert(events.items.every((r:any)=>r.merchantId===a));
    });
    await t.test("platform writes require an administrator",()=>{
      assert.equal(hasPlatformPermission("platform_admin","platform:ai-governance:write"),true);
      for(const role of ["billing_ops","auditor","support_ops","infra_ops"] as const)assert.equal(hasPlatformPermission(role,"platform:ai-governance:write"),false);
    });
    await t.test("voice authorization happens before allocating a provider session",async()=>{
      await assert.rejects(meter.openVoiceSession({merchantId:a,conversationId:"synthetic"},"gpt-realtime-2.1-mini","synthetic","voice_narration"),/ai_access_denied/);
      assert.equal(await db.aiVoiceUsageSession.count({where:{merchantId:a}}),0);
    });
    await t.test("empty policy revokes all model and MCP execution",async()=>{
      await gov.savePolicy(a,actorId,{version:1,grants:[]});
      await assert.rejects(tenant.run({merchantId:a,userId:actorId,role:"owner"},()=>call(a)),/ai_access_denied/);
      await assert.rejects(gov.authorize({merchantId:a,source:"mcp"},"tool","aacp_search_catalog"),/ai_access_denied/);
      assert.equal(await db.aiGovernancePolicyRevision.count({where:{merchantId:a}}),2);
    });
  }finally{
    meter.onModuleDestroy();
    await db.aiUsageEvent.deleteMany({where:{merchantId:{in:[a,b]}}});
    await db.product.deleteMany({where:{merchantId:{in:[a,b]}}});
    await db.merchant.deleteMany({where:{id:{in:[a,b]}}});
    await db.$disconnect();
  }
});
