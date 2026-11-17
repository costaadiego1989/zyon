import { Body, Controller, Get, Header, Put, Req, UseGuards } from "@nestjs/common";
import { ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsString, MaxLength, ValidateIf } from "class-validator";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { AuditResource } from "../../../audit/infrastructure/audit-resource.decorator.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { ManageSupportNotificationSettingsUseCase } from "../../application/manage-support-notification-settings.use-case.js";

export class UpdateSupportNotificationSettingsDto {
  @ApiProperty({ type: String, nullable: true, maxLength: 40,
    description: "Private staff WhatsApp recipient. Explicit null clears it." })
  @ValidateIf((_input, value: unknown) => value !== null)
  @IsString()
  @MaxLength(40)
  fallbackPhone!: string | null;
}

@ApiTags("Support")
@Controller("support/notification-settings")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@AuditResource("support_notification_settings")
export class SupportNotificationSettingsController {
  constructor(private readonly settings: ManageSupportNotificationSettingsUseCase) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @RequireTenantAccess({ serviceScopes: ["support:read"], humanRoles: ["owner", "admin"] })
  get(@Req() request: TenantPrincipalRequest) {
    return this.settings.get(currentTenantPrincipal(request).tenantId);
  }

  @Put()
  @Header("Cache-Control", "private, no-store")
  @RequireTenantAccess({ serviceScopes: ["support:write"], humanRoles: ["owner", "admin"] })
  save(@Req() request: TenantPrincipalRequest, @Body() body: UpdateSupportNotificationSettingsDto) {
    return this.settings.save(currentTenantPrincipal(request).tenantId, body);
  }
}
