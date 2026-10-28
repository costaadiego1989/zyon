// Run only against the explicitly selected API deployment. Credentials remain
// inside the Railway runtime and are never written into the evidence report.
const {remote,environments,evidence}=require("./ai-governance-runtime.cjs");
const fs=require("node:fs"),path=require("node:path");
const environment=process.argv[2],deployment=process.argv[3];
if(!environments[environment]||!deployment)throw Error("environment_and_deployment_required");
const base=environment==="production"?"https://api.zyon-payments.com.br":"https://api-sandbox-8146.up.railway.app";
const code=`
const {randomUUID}=require("node:crypto");
const {PrismaClient}=require("/repo/apps/api/node_modules/@prisma/client");
const db=new PrismaClient(),checks=[];
function check(ok,label){if(!ok)throw Error(label);checks.push(label);}
(async()=>{
 if(process.env.RAILWAY_DEPLOYMENT_ID!==${JSON.stringify(deployment)})throw Error("deployment_changed");
 const {PlatformJwtService}=await import("/repo/apps/api/dist/modules/platform-control/domain/services/platform-jwt.service.js");
 const {PrismaPlatformOperatorRepository}=await import("/repo/apps/api/dist/modules/platform-control/infrastructure/prisma-platform-operator.repository.js");
 const {TenantContextService}=await import("/repo/apps/api/dist/shared/tenant/tenant-context.service.js");
 const {AiGovernanceService}=await import("/repo/apps/api/dist/modules/ai-governance/ai-governance.service.js");
 const {AiMeteringService}=await import("/repo/apps/api/dist/modules/ai-metering/ai-metering.service.js");
 const {ApiKeyService}=await import("/repo/apps/api/dist/modules/integrations/domain/api-key.service.js");
 const {JwtService}=await import("/repo/apps/api/dist/modules/auth/domain/services/jwt.service.js");
 const {PrismaAuthRepository}=await import("/repo/apps/api/dist/modules/auth/infrastructure/prisma-auth.repository.js");
 const {OpenAIChatAdapter}=await import("/repo/apps/api/dist/modules/support/infrastructure/openai-chat.adapter.js");
 const {withAiMetering,meteredAiFetch}=await import("/repo/apps/api/dist/shared/ai-metering.js");
 const {withAiAutomation}=await import("/repo/apps/api/dist/shared/ai-automation.js");
 const tag="governance_smoke_"+randomUUID().replaceAll("-",""),merchantId=tag,operators=[];
 const tenant=new TenantContextService(),gov=new AiGovernanceService(db,tenant),meter=new AiMeteringService(db,tenant,null,gov);
 const jwt=new PlatformJwtService(new PrismaPlatformOperatorRepository(db));
 const request=async(route,token,options={})=>{
  const r=await fetch(${JSON.stringify(base)}+"/v1"+route,{...options,redirect:"error",signal:AbortSignal.timeout(20000),headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...options.headers}});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{}
  return {status:r.status,data,text};
 };
 try {
  await db.merchant.create({data:{id:merchantId,name:"Governance release validation"}});
  await db.merchantBillingSubscription.create({data:{merchantId,status:"active",planKey:"scale"}});
  const tokens={};
  for(const role of ["platform_admin","auditor"]){
   const op=await db.platformOperator.create({data:{email:tag+"_"+role+"@example.test",role}});operators.push(op.id);
   tokens[role]=await jwt.issue({operatorId:op.id,email:op.email,role},0);
  }
  const auth=tokens.platform_admin;
  const policy=await request("/platform/ai-governance/"+merchantId+"/policy",auth);
  check(policy.status===200&&policy.data.mode==="deployed_catalog","authenticated_policy_200");
  const denied=await request("/platform/ai-governance/"+merchantId+"/policy",tokens.auditor,{method:"PUT",body:JSON.stringify({version:0,grants:[]})});
  check(denied.status===403,"auditor_write_403");
  check((await request("/platform/ai-governance?merchantId="+merchantId,tokens.auditor)).status===200,"auditor_read_200");
  check((await request("/platform/ai-governance/"+merchantId+"/team",auth,{method:"PUT",body:JSON.stringify({principalId:"source:product_seo",teamId:"release-validation"})})).status===200,"team_assignment_200");
  check((await request("/platform/ai-governance/"+merchantId+"/baseline",auth,{method:"PUT",body:JSON.stringify({taskType:"product_seo",humanMs:60000,sampleSize:1})})).status===200,"baseline_200");
  meter.onModuleInit();
  const owner=await db.merchantUser.create({data:{merchantId,email:tag+"_owner@example.test",role:"owner"}});
  await db.merchantTeamMember.create({data:{merchantId,userId:owner.id,role:"OWNER"}});
  const ownerToken=await new JwtService(process.env.JWT_SECRET,120,new PrismaAuthRepository(db)).issue({merchantId,userId:owner.id,email:owner.email,role:"owner"},0);
  const product=await db.product.create({data:{merchantId,name:"Livro de validação de governança",description:"Livro sintético usado somente para verificar a geração de SEO. Não é publicado para venda."}});
  const seo=await request("/merchants/"+merchantId+"/products/"+product.id+"/generate-seo",ownerToken,{method:"POST",body:JSON.stringify({tone:"profissional"})});
  check(seo.status===201&&Boolean(seo.data?.seoTitle)&&Boolean(seo.data?.metaDescription),"native_seo_http_real_generation_201");
  const event=await db.aiUsageEvent.findFirstOrThrow({where:{merchantId}}),task=await db.aiAutomationTask.findFirstOrThrow({where:{merchantId}});
  check(event.provider==="deepseek"&&event.usageKnown&&event.taskId===task.id&&event.teamId==="release-validation"&&event.actorId===owner.id&&event.actorRole==="owner","provider_usage_persisted_with_verified_actor_task_and_team");
  check(task.status==="succeeded"&&task.baselineHumanMs===60000,"task_and_frozen_baseline_persisted");
  check((await request("/platform/ai-governance/"+merchantId+"/tasks/"+task.id+"/human-time",auth,{method:"POST",body:JSON.stringify({humanMs:0})})).status===201,"human_time_observation_201");
  const report=await request("/platform/ai-governance?merchantId="+merchantId,auth);
  check(report.status===200&&report.data.tasks.completed==="1"&&report.data.tasks.estimatedHumanMsAvoided==="60000","report_matches_durable_task");
  const costs=await request("/platform/ai-costs?merchantId="+merchantId,auth);
  check(costs.status===200&&costs.data.summary.calls==="1","cost_api_200_and_one_physical_call");
  const csv=await request("/platform/ai-costs/export?merchantId="+merchantId,auth);
  check(csv.status===200&&csv.text.split("\\r\\n")[0].includes("teamId"),"csv_contains_attribution");
  const generated=new ApiKeyService().generate("test");
  await db.merchantApiKey.create({data:{id:tag+"_key",merchantId,name:"Temporary release validation",keyHash:generated.keyHash,keyPrefix:generated.keyPrefix,scopes:["configuration:read","catalog:read"],environment:"test",expiresAt:new Date(Date.now()+120000)}});
  const serviceHeaders={"x-aacp-api-key":generated.rawKey};
  const tool=await request("/ai-governance/tools/authorize","",{method:"POST",headers:serviceHeaders,body:JSON.stringify({tool:"aacp_search_catalog",merchantId})});
  check(tool.status===201&&tool.data.merchantId===merchantId,"mcp_service_authorization_201");
  check((await request("/ai-governance/tools/catalog?query=synthetic&limit=1","",{headers:serviceHeaders})).status===200,"mcp_authenticated_catalog_200");
  check((await request("/ai-governance/tools/authorize","",{method:"POST",headers:serviceHeaders,body:JSON.stringify({tool:"aacp_search_catalog",merchantId:"another-tenant"})})).status===400,"mcp_foreign_tenant_400");
  const support=await withAiMetering({merchantId,source:"buyer_support"},()=>new OpenAIChatAdapter().complete([{role:"user",content:"Responda apenas OK."}]));
  const supportUsage=await db.aiUsageEvent.findFirst({where:{merchantId,source:"buyer_support"}});
  check(Boolean(support)&&supportUsage?.provider==="deepseek"&&supportUsage.usageKnown,"text_support_uses_funded_deepseek");
  if(process.env.OPS_SHARED_SECRET){
   const metrics=await request("/metrics","",{headers:{"x-ops-secret":process.env.OPS_SHARED_SECRET}});
   check(metrics.status===200&&metrics.text.includes("ai_policy_decisions_total")&&metrics.text.includes("ai_automation_tasks_total")&&metrics.text.includes("ai_automation_duration_seconds"),"bounded_ai_metrics_exposed");
  }
  check((await request("/platform/ai-governance/"+merchantId+"/policy",auth,{method:"PUT",body:JSON.stringify({version:0,grants:[]})})).status===200,"empty_policy_published");
  let dispatches=0,blocked=false;
  try{await withAiMetering({merchantId,source:"product_seo"},()=>meteredAiFetch("product_seo",async()=>{dispatches++;return new Response("{}");})("https://api.deepseek.com/v1/chat/completions",{body:JSON.stringify({model:process.env.DEEPSEEK_MODEL||"deepseek-chat"})}));}catch(e){blocked=e.message==="ai_access_denied";}
  check(blocked&&dispatches===0,"policy_blocks_before_provider_dispatch");
  console.log(JSON.stringify({environment:${JSON.stringify(environment)},deploymentId:process.env.RAILWAY_DEPLOYMENT_ID,at:new Date().toISOString(),passed:true,checks,usage:{model:event.model,input:event.promptTokens,output:event.completionTokens,costMicros:event.costMicros?.toString(),currency:event.currency,costStatus:event.costStatus}}));
 }finally{
  meter.onModuleDestroy();
  await db.aiUsageEvent.deleteMany({where:{merchantId}});
  await db.product.deleteMany({where:{merchantId}});
  await db.merchantUser.deleteMany({where:{merchantId}});
  await db.merchantBillingSubscription.deleteMany({where:{merchantId}});
  await db.merchant.deleteMany({where:{id:merchantId}});
  await db.platformAuditEvent.deleteMany({where:{actorOperatorId:{in:operators}}});
  await db.platformOperator.deleteMany({where:{id:{in:operators}}});
  await db.$disconnect();
 }
})().catch(error=>{console.log(JSON.stringify({environment:${JSON.stringify(environment)},deploymentId:process.env.RAILWAY_DEPLOYMENT_ID,passed:false,checks,failure:/^[a-z_0-9]{1,100}$/.test(error.message)?error.message:"runtime_smoke_failed"}));});`;
const output=remote(environment,code);
// Nest's application logs may precede the report. Persist only the allowlisted report.
const line=output.split(/\r?\n/).findLast(line=>line.startsWith('{"environment":'));
if(!line)throw Error("runtime_smoke_report_missing");
const report=JSON.parse(line);
fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,environment+"-deployed-smoke.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(!report.passed)process.exitCode=1;
