import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { GetPolicyUseCase } from "../../application/use-cases/get-policy.use-case.js";
import { UpdatePolicyUseCase } from "../../application/use-cases/update-policy.use-case.js";
import { UpdateMerchantPolicyDto } from "./merchant-policy.dto.js";

function tenantId(request: unknown): string {
  return currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  ).tenantId;
}

@ApiTags("Knowledge Base")
@Controller("knowledge/policies")
export class MerchantPolicyController {
  constructor(
    private readonly getPolicy: GetPolicyUseCase,
    private readonly updatePolicy: UpdatePolicyUseCase,
  ) {}

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @ApiOperation({
    summary: "Get merchant policies",
    description: "Retrieve the free-text store policies for the current merchant.",
  })
  @ApiResponse({ status: 200, description: "Policies retrieved" })
  @ApiResponse({ status: 403, description: "Missing support:read scope" })
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:read"] })
  @Get()
  getPolicies(@Req() request: unknown) {
    return this.getPolicy.execute(tenantId(request));
  }

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @ApiOperation({
    summary: "Update merchant policies",
    description: "Save free-text store policies and reindex them into the knowledge base.",
  })
  @ApiResponse({ status: 200, description: "Policies saved and indexed" })
  @ApiResponse({ status: 400, description: "Invalid body" })
  @ApiResponse({ status: 403, description: "Missing support:write scope" })
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:write"] })
  @Put()
  updatePolicies(@Req() request: unknown, @Body() body: UpdateMerchantPolicyDto) {
    return this.updatePolicy.execute(tenantId(request), body);
  }
}
