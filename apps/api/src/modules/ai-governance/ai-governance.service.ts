import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import {randomUUID} from "node:crypto";
import { PRISMA_CROSS_MERCHANT_CLIENT } from "../../shared/persistence/persistence.module.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";
import type { AiMeteringContext } from "../../shared/ai-metering.js";
import { decideAccess, isAiActorRole, parseGrants, safeIdentifier, AI_TOOLS, type AiGrant, type AiIdentity } from "./ai-access-policy.js";
import { deployedModels } from "./model-catalog.js";
import { MetricsService } from "../../shared/observability/metrics.service.js";

@Injectable()
export class AiGovernanceService {
  private readonly logger = new Logger(AiGovernanceService.name);
  readonly models = deployedModels();
  constructor(@Inject(PRISMA_CROSS_MERCHANT_CLIENT) private readonly db: PrismaClient, private readonly tenant: TenantContextService,
    @Optional() private readonly metrics?:MetricsService) {}

  async identity(context: AiMeteringContext): Promise<AiIdentity> {
    if (!safeIdentifier(context.merchantId) || !safeIdentifier(context.source)) throw new ForbiddenException("ai_invalid_context");
    const tenant = this.tenant.get();
    if (tenant && tenant.merchantId !== context.merchantId) throw new ForbiddenException("ai_tenant_context_mismatch");
    const voice=context.voiceSessionId?await this.db.aiVoiceUsageSession.findUnique({where:{id:context.voiceSessionId}}):null;
    if(context.voiceSessionId&&(!voice||voice.merchantId!==context.merchantId))throw new ForbiddenException("ai_voice_scope_mismatch");
    const role = voice?.actorRole ?? (tenant?.role === "embed" ? "buyer" : tenant?.role ??
      (/^(storefront|checkout|buyer_support|voice_)/.test(context.source) ? "buyer" : "service"));
    if (!isAiActorRole(role)) throw new ForbiddenException("ai_invalid_actor_role");
    const assignments = await this.db.aiActorTeam.findMany({where:{merchantId:context.merchantId,
      actorId:{in:[...(tenant?.userId ? [tenant.userId] : []),"source:"+context.source]}}});
    const team = assignments.find(a=>a.actorId===tenant?.userId) ?? assignments.find(a=>a.actorId==="source:"+context.source);
    return {merchantId:context.merchantId,actorRole:role,actorId:voice?.actorId??tenant?.userId,teamId:voice?.teamId??team?.teamId,source:context.source,correlationId:tenant?.correlationId};
  }

  async authorize(context: AiMeteringContext, kind: AiGrant["kind"], resource: string) {
    const identity = await this.identity(context);
    const stored = await this.db.aiGovernancePolicy.findUnique({where:{merchantId:identity.merchantId}});
    const policy = stored ? {version:stored.version,grants:parseGrants(stored.grants,this.models)} : null;
    const decision = decideAccess(policy,identity,kind,resource,this.models);
    await this.db.aiGovernanceDecision.create({data:{...identity,resourceKind:kind,resource:resource.slice(0,200),
      allowed:decision.allowed,reason:decision.reason,policyVersion:policy?.version}});
    this.metrics?.recordAiPolicy(kind,decision.allowed,decision.reason);
    if (!decision.allowed) throw new ForbiddenException({code:"ai_access_denied",message:"ai_access_denied",reason:decision.reason});
    return identity;
  }

  async policy(merchantId: string) {
    if(!safeIdentifier(merchantId))throw new BadRequestException("ai_invalid_merchant");
    const policy = await this.db.aiGovernancePolicy.findUnique({where:{merchantId}});
    return {merchantId,version:policy?.version??0,mode:policy?"explicit_policy":"deployed_catalog",
      grants:policy?.grants??null,models:[...this.models].sort(),tools:AI_TOOLS};
  }

  async savePolicy(merchantId: string, actorId: string, input: {version?:unknown;grants?:unknown}) {
    if(!safeIdentifier(merchantId))throw new BadRequestException("ai_invalid_merchant");
    let grants: AiGrant[];
    try { grants=parseGrants(input.grants,this.models); } catch(error) { throw new BadRequestException((error as Error).message); }
    if (!Number.isInteger(input.version) || Number(input.version)<0) throw new BadRequestException("ai_policy_version_required");
    try {
      return await this.db.$transaction(async tx=>{
        const current = await tx.aiGovernancePolicy.findUnique({where:{merchantId}});
        if ((current?.version??0)!==input.version) throw new ConflictException("ai_policy_version_changed");
        const version=Number(input.version)+1, data={grants:grants as unknown as Prisma.InputJsonValue,version,updatedBy:actorId};
        if (current) {
          const saved=await tx.aiGovernancePolicy.updateMany({where:{merchantId,version:current.version},data});
          if(saved.count!==1)throw new ConflictException("ai_policy_version_changed");
        } else await tx.aiGovernancePolicy.create({data:{merchantId,...data}});
        await tx.aiGovernancePolicyRevision.create({data:{merchantId,...data}});
        return {merchantId,version,grants};
      });
    } catch(error) {
      if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2002")throw new ConflictException("ai_policy_version_changed");
      throw error;
    }
  }

  async toolCatalog(merchantId:string,query:unknown,limit:unknown) {
    if(typeof query!=="string"||query.length>200||!Number.isInteger(Number(limit))||Number(limit)<1||Number(limit)>50)
      throw new BadRequestException("ai_catalog_invalid_query");
    await this.authorize({merchantId,source:"mcp"},"tool","aacp_search_catalog");
    const rows=await this.db.productVariant.findMany({
      where:{isActive:true,product:{merchantId,isActive:true,deletedAt:null,name:{contains:query,mode:"insensitive"}},price:{isNot:null}},
      take:Number(limit),orderBy:{id:"asc"},
      select:{sku:true,product:{select:{id:true,name:true}},price:{select:{basePriceInCents:true,currency:true}},media:{where:{type:"IMAGE"},orderBy:{order:"asc"},take:1,select:{url:true}}},
    });
    return {products:rows.map(row=>({id:row.product.id,sku:row.sku,title:row.product.name,priceCents:row.price!.basePriceInCents,currency:row.price!.currency,imageUrl:row.media[0]?.url}))};
  }

  async assignTeam(merchantId:string, actorId:string, input:{principalId?:unknown;teamId?:unknown}) {
    if(!safeIdentifier(input.principalId)||!safeIdentifier(input.teamId))throw new BadRequestException("ai_team_invalid_assignment");
    if(!input.principalId.startsWith("source:")&&!await this.db.merchantUser.findFirst({where:{id:input.principalId,merchantId}}))
      throw new BadRequestException("ai_team_actor_not_in_tenant");
    return this.db.aiActorTeam.upsert({where:{merchantId_actorId:{merchantId,actorId:input.principalId}},
      create:{merchantId,actorId:input.principalId,teamId:input.teamId,updatedBy:actorId},
      update:{teamId:input.teamId,updatedBy:actorId}});
  }

  async baseline(merchantId:string,actorId:string,input:{taskType?:unknown;humanMs?:unknown;sampleSize?:unknown}) {
    if(!["product_seo","store_seo"].includes(String(input.taskType))||!Number.isSafeInteger(input.humanMs)||Number(input.humanMs)<1||Number(input.humanMs)>86400000||
      !Number.isSafeInteger(input.sampleSize)||Number(input.sampleSize)<1||Number(input.sampleSize)>100000)throw new BadRequestException("ai_baseline_invalid");
    const taskType=String(input.taskType),humanMs=Number(input.humanMs),sampleSize=Number(input.sampleSize);
    return this.db.aiTaskBaseline.upsert({where:{merchantId_taskType:{merchantId,taskType}},
      create:{merchantId,taskType,humanMs,sampleSize,updatedBy:actorId},update:{humanMs,sampleSize,version:{increment:1},updatedBy:actorId}});
  }

  async beginTask(context:AiMeteringContext & {taskType:string}) {
    const identity=await this.identity(context);
    const baseline=await this.db.aiTaskBaseline.findUnique({where:{merchantId_taskType:{merchantId:context.merchantId,taskType:context.taskType}}});
    return this.db.aiAutomationTask.create({data:{merchantId:identity.merchantId,actorId:identity.actorId,actorRole:identity.actorRole,
      teamId:identity.teamId,source:context.source,taskType:context.taskType,baselineVersion:baseline?.version,baselineHumanMs:baseline?.humanMs}});
  }

  async finishTask(id:string,status:"succeeded"|"failed") {
    try {
      const task=await this.db.aiAutomationTask.findUnique({where:{id}});
      if(!task||task.status!=="pending")return;
      const completedAt=new Date();
      const elapsedMs=Math.min(2147483647,Math.max(0,completedAt.getTime()-task.startedAt.getTime()));
      const saved=await this.db.aiAutomationTask.updateMany({where:{id,status:"pending"},data:{status,completedAt,elapsedMs}});
      if(saved.count===1)this.metrics?.recordAiAutomation(task.taskType,status,elapsedMs);
    } catch { this.logger.error({event:"ai_automation_completion_pending",taskId:id}); }
  }

  async observeHumanTime(merchantId:string,actorId:string,id:string,humanMs:unknown) {
    if(!safeIdentifier(id)||!Number.isSafeInteger(humanMs)||Number(humanMs)<0||Number(humanMs)>86400000)throw new BadRequestException("ai_observation_invalid");
    const result=await this.db.aiAutomationTask.updateMany({where:{id,merchantId,status:"succeeded",observationAt:null},
      data:{observedHumanMs:Number(humanMs),observationBy:actorId,observationAt:new Date()}});
    if(result.count!==1)throw new ConflictException("ai_task_unavailable_or_already_observed");
    return {recorded:true};
  }

  async auditRead(actorOperatorId:string,action:string,targetId?:string) {
    await this.db.platformAuditEvent.create({data:{actorOperatorId,action,permission:"platform:ai-governance:read",
      environment:process.env.APP_ENV??process.env.NODE_ENV??"unknown",targetType:"ai_governance",targetId,
      correlationId:randomUUID(),outcome:"succeeded",details:{}}});
  }

  async report(query:{from?:string;to?:string;merchantId?:string;teamId?:string;actorId?:string}) {
    const to=query.to?new Date(query.to):new Date(),from=query.from?new Date(query.from):new Date(to.getTime()-30*86400000);
    if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||from>=to||to.getTime()-from.getTime()>366*86400000)throw new BadRequestException("ai_governance_invalid_period");
    for(const value of [query.merchantId,query.teamId,query.actorId])if(value!==undefined&&!safeIdentifier(value))throw new BadRequestException("ai_governance_invalid_filter");
    const scoped=(column:string)=>Prisma.sql`${Prisma.raw(column)} >= ${from} AND ${Prisma.raw(column)} < ${to}`;
    const terms=[scoped("started_at")];
    if(query.merchantId)terms.push(Prisma.sql`merchant_id=${query.merchantId}`);
    if(query.teamId)terms.push(Prisma.sql`team_id=${query.teamId}`);
    if(query.actorId)terms.push(Prisma.sql`actor_id=${query.actorId}`);
    const where=Prisma.join(terms," AND ");
    return this.db.$transaction(async tx=>{
      const [tasks]=await tx.$queryRaw<Array<Record<string,string|null>>>(Prisma.sql`SELECT COUNT(*)::text AS total,
        COUNT(*) FILTER(WHERE status='succeeded')::text AS completed, COUNT(*) FILTER(WHERE status='failed')::text AS failed,
        COUNT(*) FILTER(WHERE status='pending')::text AS pending,
        COUNT(*) FILTER(WHERE status='succeeded' AND baseline_human_ms IS NOT NULL)::text AS "withBaseline",
        COUNT(*) FILTER(WHERE status='succeeded' AND observed_human_ms IS NOT NULL)::text AS "withHumanObservation",
        SUM(elapsed_ms)::text AS "observedExecutionMs", SUM(observed_human_ms) FILTER(WHERE status='succeeded')::text AS "observedHumanMs",
        SUM(GREATEST(baseline_human_ms-observed_human_ms,0)) FILTER(WHERE status='succeeded' AND baseline_human_ms IS NOT NULL AND observed_human_ms IS NOT NULL)::text AS "estimatedHumanMsAvoided"
        FROM ai_automation_tasks WHERE ${where}`);
      const costs=await tx.$queryRaw(Prisma.sql`SELECT currency, cost_status AS "costStatus",SUM(cost_micros)::text AS "costMicros",COUNT(*)::text AS calls
        FROM ai_usage_events WHERE ${where} AND measurement_origin IN ('server_http','server_sideband') AND cost_micros IS NOT NULL
        GROUP BY currency,cost_status ORDER BY currency,cost_status`);
      const breakdown=await tx.$queryRaw(Prisma.sql`SELECT merchant_id AS "merchantId",team_id AS "teamId",actor_role AS "actorRole",
        source,COUNT(*)::text AS calls,COUNT(*) FILTER(WHERE NOT usage_known)::text AS "pendingUsage"
        FROM ai_usage_events WHERE ${where} AND measurement_origin IN ('server_http','server_sideband')
        GROUP BY merchant_id,team_id,actor_role,source ORDER BY COUNT(*) DESC LIMIT 100`);
      const taskRows=await tx.aiAutomationTask.findMany({where:{merchantId:query.merchantId,teamId:query.teamId,actorId:query.actorId,startedAt:{gte:from,lt:to}},orderBy:{startedAt:"desc"},take:50});
      const decisionWhere={merchantId:query.merchantId,teamId:query.teamId,actorId:query.actorId,createdAt:{gte:from,lt:to}};
      const decisions=await tx.aiGovernanceDecision.groupBy({by:["allowed","reason"],where:decisionWhere,_count:{_all:true}});
      return {period:{from:from.toISOString(),to:to.toISOString(),endExclusive:true},tasks,costs,breakdown,decisions,recentTasks:taskRows,
        coverage:{timeSavings:"Estimated from a frozen human baseline and operator-reported handling time; unavailable values remain null.",profit:"Not calculated: revenue, fees, product costs and currency reconciliation require separate measured inputs."}};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});
  }
}
