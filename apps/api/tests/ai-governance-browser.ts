import "reflect-metadata";
import {Module,Controller,Get,Req,UseGuards} from "@nestjs/common";
import {NestFactory,Reflector} from "@nestjs/core";
import {PrismaClient} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright";
import {AiGovernanceService} from "../src/modules/ai-governance/ai-governance.service.js";
import {AiCostsController} from "../src/modules/ai-metering/ai-costs.controller.js";
import {AiCostsReader} from "../src/modules/ai-metering/ai-costs.reader.js";
import {PlatformAiGovernanceController} from "../src/modules/ai-governance/ai-governance.controller.js";
import {TenantContextService} from "../src/shared/tenant/tenant-context.service.js";
import {PlatformAccessGuard} from "../src/modules/platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../src/modules/platform-control/presentation/platform-permission.guard.js";
import {PlatformJwtService} from "../src/modules/platform-control/domain/services/platform-jwt.service.js";
import {PrismaPlatformOperatorRepository} from "../src/modules/platform-control/infrastructure/prisma-platform-operator.repository.js";
import {currentPlatformPrincipal} from "../src/modules/platform-control/presentation/platform-principal.js";
import assert from "node:assert/strict";
const url=process.env.AI_GOVERNANCE_TEST_DATABASE_URL!;
if(!url||!["localhost","127.0.0.1"].includes(new URL(url).hostname)||!new URL(url).pathname.startsWith("/support_test"))throw Error("isolated_database_required");
const db=new PrismaClient({datasources:{db:{url}}}),context=new TenantContextService(),governance=new AiGovernanceService(db,context),reader=new AiCostsReader(db);
const jwt=new PlatformJwtService(new PrismaPlatformOperatorRepository(db),"governance-fixture-secret-with-over-32-characters",3600);
// The source test loader deliberately omits decorator metadata. Supply only
// these constructor types so this fixture runs the real production guards.
Reflect.defineMetadata("design:paramtypes",[PlatformJwtService],PlatformAccessGuard);
Reflect.defineMetadata("design:paramtypes",[Reflector],PlatformPermissionGuard);
Reflect.defineMetadata("design:paramtypes",[AiGovernanceService],PlatformAiGovernanceController);
Reflect.defineMetadata("design:paramtypes",[AiCostsReader],AiCostsController);
@Controller("platform/auth") class FixtureAuth {
  @Get("me") @UseGuards(PlatformAccessGuard)
  me(@Req() req:any){const p=currentPlatformPrincipal(req);return{operator_id:p.operatorId,email:p.email,role:p.role};}
}
@Module({controllers:[FixtureAuth,PlatformAiGovernanceController,AiCostsController],providers:[
  {provide:PlatformJwtService,useValue:jwt},PlatformAccessGuard,PlatformPermissionGuard,{provide:AiGovernanceService,useValue:governance},{provide:AiCostsReader,useValue:reader}]})
class FixtureModule{}
const tag="browser_"+randomUUID().replaceAll("-",""),merchantId=tag+"_merchant",actors:string[]=[];
const evidence="../../.audit/ai-governance-20261027/browser";mkdirSync(evidence,{recursive:true});
let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
  await db.merchant.create({data:{id:merchantId,name:"Validação de governança"}});
  const task=await db.aiAutomationTask.create({data:{merchantId,actorRole:"service",source:"product_seo",taskType:"product_seo",status:"succeeded",baselineVersion:1,baselineHumanMs:120000,observedHumanMs:30000,completedAt:new Date(),elapsedMs:1250}});
  await db.aiUsageEvent.create({data:{merchantId,idempotencyKey:tag,source:"product_seo",channel:"chat",component:"text_generation",provider:"openai",model:"gpt-4o-mini",actorRole:"service",teamId:"catalogo",taskId:task.id,measurementOrigin:"server_http",usageKnown:true,executionStatus:"succeeded",startedAt:new Date(),completedAt:new Date(),latencyMs:1250,promptTokens:1000,completionTokens:100,totalTokens:1100,currency:"USD",costMicros:195n,costStatus:"estimated"}});
  async function session(role:"platform_admin"|"auditor"){
    const op=await db.platformOperator.create({data:{email:tag+"_"+role+"@example.test",role}});actors.push(op.id);
    return {token:await jwt.issue({operatorId:op.id,email:op.email,role},0),operator:{operator_id:op.id,email:op.email,role}};
  }
  const admin=await session("platform_admin"),auditor=await session("auditor");
  assert.equal((await jwt.authenticate(admin.token)).operatorId,admin.operator.operator_id);
  app=await NestFactory.create(FixtureModule,{logger:["error"]});app.setGlobalPrefix("v1");app.enableCors({origin:"http://127.0.0.1:5176",credentials:true});await app.listen(56459,"127.0.0.1");
  assert.equal((app.get(PlatformAccessGuard) as any).jwt,jwt,"fixture guard must use the authenticated session issuer");
  const ready=await fetch("http://127.0.0.1:56459/v1/platform/ai-governance",{headers:{Authorization:"Bearer "+admin.token}});
  if(!ready.ok)throw Error("governance_http_"+ready.status+":"+await ready.text());
  browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  await ctx.addInitScript(data=>sessionStorage.setItem("zyon.platform-control.session.v1",JSON.stringify(data)),admin);
  const page=await ctx.newPage(),pageErrors:string[]=[];page.on("pageerror",e=>pageErrors.push(e.message));
  await page.goto("http://127.0.0.1:5176/");
  await page.getByRole("button",{name:"Governança de IA",exact:true}).click();
  await page.getByRole("heading",{name:"Governança de IA",exact:true,level:1}).waitFor();
  await page.getByRole("textbox",{name:"ID da empresa",exact:true}).fill(merchantId);
  await page.getByRole("button",{name:"Aplicar filtros",exact:true}).click();
  await page.getByText("1,5 min",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Consultar política",exact:true}).click();
  await page.getByText("Catálogo configurado pela plataforma",{exact:false}).waitFor();
  await page.locator("summary").filter({hasText:"Atribuir equipe"}).click();
  await page.getByLabel("Origem ou ID do usuário",{exact:true}).fill("source:product_seo");
  await page.getByLabel("Equipe",{exact:true}).last().fill("catalogo");
  await page.getByRole("button",{name:"Salvar atribuição",exact:true}).click();
  await page.getByRole("status").filter({hasText:"Alteração registrada."}).waitFor();
  assert.equal((await db.aiActorTeam.findUniqueOrThrow({where:{merchantId_actorId:{merchantId,actorId:"source:product_seo"}}})).teamId,"catalogo");
  await page.screenshot({path:evidence+"/desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:evidence+"/mobile.png",fullPage:true,animations:"disabled"});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"mobile document overflows horizontally");
  assert.deepEqual(pageErrors,[]);
  const denied=await fetch("http://127.0.0.1:56459/v1/platform/ai-governance/"+merchantId+"/policy",{method:"PUT",headers:{Authorization:"Bearer "+auditor.token,"Content-Type":"application/json"},body:JSON.stringify({version:0,grants:[]})});
  assert.equal(denied.status,403);
  const read=await fetch("http://127.0.0.1:56459/v1/platform/ai-governance?merchantId="+merchantId,{headers:{Authorization:"Bearer "+auditor.token}});
  assert.equal(read.status,200);
  const report={at:new Date().toISOString(),passed:true,checks:["real browser and authenticated controllers","real PostgreSQL aggregates","team assignment persisted","desktop and mobile without document overflow","auditor reads but cannot mutate","no browser page errors"]};
  writeFileSync(evidence+"/results.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  const page=browser?.contexts()[0]?.pages()[0];
  if(page){await page.screenshot({path:evidence+"/failure.png",fullPage:true});writeFileSync(evidence+"/failure.txt",await page.locator("body").innerText());}
  throw error;
}finally{
  await browser?.close();await app?.close();
  await db.aiUsageEvent.deleteMany({where:{merchantId}});
  await db.merchant.deleteMany({where:{id:merchantId}});
  await db.platformAuditEvent.deleteMany({where:{actorOperatorId:{in:actors}}});
  await db.platformOperator.deleteMany({where:{id:{in:actors}}});await db.$disconnect();
}
