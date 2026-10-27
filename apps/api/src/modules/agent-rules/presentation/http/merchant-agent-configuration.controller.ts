import { Body, Controller, Get, Put, Req, UseGuards, ValidationPipe } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsDefined, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { MerchantAgentConfigurationService } from "../../application/merchant-agent-configuration.service.js";
import { AgentIdentityPatchDto } from "./dto/agent-rules-patch.dto.js";

class MerchantAgentConfigurationDto {
  @IsDefined() @ValidateNested() @Type(() => AgentIdentityPatchDto)
  identity!: AgentIdentityPatchDto;
  @IsIn(["proactive", "manual_only", "silent_until_trigger"])
  mode!: "proactive" | "manual_only" | "silent_until_trigger";
  @IsObject() quickReplies!: Record<string, string[]>;
  @IsOptional() @IsString() @MaxLength(500) revision?: string;
}

@UseGuards(AuthGuard)
@Controller("merchant-agent-configuration")
export class MerchantAgentConfigurationController {
  constructor(private readonly configuration: MerchantAgentConfigurationService) {}
  @Get()
  get(@Req() request: Parameters<typeof currentUser>[0]) {
    return this.configuration.get(currentUser(request).merchantId);
  }
  @Put()
  update(@Req() request: Parameters<typeof currentUser>[0], @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })) body: MerchantAgentConfigurationDto) {
    return this.configuration.update(currentUser(request).merchantId, body);
  }
}
