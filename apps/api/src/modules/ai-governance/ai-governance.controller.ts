import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { AiGovernanceService } from "./ai-governance.service.js";
import { AuthGuard, currentUser } from "../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../auth/presentation/tenant-role.guard.js";
import { RequireTenantRoles } from "../auth/presentation/tenant-role.decorator.js";
import { TenantCredentialGuard } from "../integrations/presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "../integrations/presentation/http/tenant-access.guard.js";
import { RequireTenantAccess } from "../integrations/presentation/http/tenant-access.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../shared/auth/tenant-principal.js";
import { PlatformAccessGuard } from "../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../platform-control/presentation/platform-principal.js";

function body(value: unknown): Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new BadRequestException("ai_governance_invalid_body");
  return value as Record<string,unknown>;
}
type ReportQuery={from?:string;to?:string;merchantId?:string;teamId?:string;actorId?:string};
@Controller("ai-governance")
@UseGuards(AuthGuard,TenantRoleGuard)
@RequireTenantRoles("owner","admin")
export class MerchantAiGovernanceController {
  constructor(private readonly governance:AiGovernanceService) {}
  @Get() report(@Req() request:any,@Query() query:ReportQuery) {return this.governance.report({...query,merchantId:currentUser(request).merchantId});}
  @Get("policy") policy(@Req() request:any) {return this.governance.policy(currentUser(request).merchantId);}
  @Put("policy") save(@Req() request:any,@Body() value:unknown) {const p=currentUser(request);return this.governance.savePolicy(p.merchantId,p.userId,body(value));}
  @Put("team") team(@Req() request:any,@Body() value:unknown) {const p=currentUser(request);return this.governance.assignTeam(p.merchantId,p.userId,body(value));}
  @Put("baseline") baseline(@Req() request:any,@Body() value:unknown) {const p=currentUser(request);return this.governance.baseline(p.merchantId,p.userId,body(value));}
  @Post("tasks/:id/human-time") observe(@Req() request:any,@Param("id") id:string,@Body() value:unknown) {const p=currentUser(request);return this.governance.observeHumanTime(p.merchantId,p.userId,id,body(value).humanMs);}
}
@Controller("ai-governance/tools")
@UseGuards(TenantCredentialGuard,TenantAccessGuard)
@RequireTenantAccess({humanRoles:["owner","admin"],serviceScopes:["configuration:read"]})
export class AiToolAuthorizationController {
  constructor(private readonly governance:AiGovernanceService) {}
  @Get("catalog")
  @RequireTenantAccess({humanRoles:["owner","admin"],serviceScopes:["configuration:read","catalog:read"]})
  catalog(@Req() request:TenantPrincipalRequest,@Query("query") query="",@Query("limit") limit="10") {
    return this.governance.toolCatalog(currentTenantPrincipal(request).tenantId,query,limit);
  }
  @Post("authorize") async authorize(@Req() request:TenantPrincipalRequest,@Body() value:unknown) {
    const p=currentTenantPrincipal(request),input=body(value);
    if(input.merchantId!==undefined&&input.merchantId!==p.tenantId)throw new BadRequestException("ai_tool_tenant_mismatch");
    if(typeof input.tool!=="string")throw new BadRequestException("ai_tool_required");
    const identity=await this.governance.authorize({merchantId:p.tenantId,source:"mcp"},"tool",input.tool);
    return {allowed:true,merchantId:p.tenantId,actorRole:identity.actorRole};
  }
}
@Controller("platform/ai-governance")
@UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
export class PlatformAiGovernanceController {
  constructor(private readonly governance:AiGovernanceService) {}
  @Get() @RequirePlatformPermissions("platform:ai-governance:read")
  async report(@Req() request:PlatformPrincipalRequest,@Query() query:ReportQuery) {
    const report=await this.governance.report(query);
    await this.governance.auditRead(currentPlatformPrincipal(request).operatorId,"ai_governance.report.read");
    return report;
  }
  @Get(":merchantId/policy") @RequirePlatformPermissions("platform:ai-governance:read")
  async policy(@Req() request:PlatformPrincipalRequest,@Param("merchantId") id:string) {
    const policy=await this.governance.policy(id);
    await this.governance.auditRead(currentPlatformPrincipal(request).operatorId,"ai_governance.policy.read",id);
    return policy;
  }
  @Put(":merchantId/policy") @RequirePlatformPermissions("platform:ai-governance:write")
  save(@Req() request:PlatformPrincipalRequest,@Param("merchantId") id:string,@Body() value:unknown) {
    return this.governance.savePolicy(id,currentPlatformPrincipal(request).operatorId,body(value));
  }
  @Put(":merchantId/team") @RequirePlatformPermissions("platform:ai-governance:write")
  team(@Req() request:PlatformPrincipalRequest,@Param("merchantId") id:string,@Body() value:unknown) {
    return this.governance.assignTeam(id,currentPlatformPrincipal(request).operatorId,body(value));
  }
  @Put(":merchantId/baseline") @RequirePlatformPermissions("platform:ai-governance:write")
  baseline(@Req() request:PlatformPrincipalRequest,@Param("merchantId") id:string,@Body() value:unknown) {
    return this.governance.baseline(id,currentPlatformPrincipal(request).operatorId,body(value));
  }
  @Post(":merchantId/tasks/:id/human-time") @RequirePlatformPermissions("platform:ai-governance:write")
  observe(@Req() request:PlatformPrincipalRequest,@Param("merchantId") merchantId:string,@Param("id") id:string,@Body() value:unknown) {
    return this.governance.observeHumanTime(merchantId,currentPlatformPrincipal(request).operatorId,id,body(value).humanMs);
  }
}
