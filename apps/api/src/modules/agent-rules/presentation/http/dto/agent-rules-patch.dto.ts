import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";

export class AgentIdentityPatchDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  agentName?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  persona?: string;

  @IsIn(["consultative", "premium", "direct", "friendly", "technical"])
  @IsOptional()
  tone?: "consultative" | "premium" | "direct" | "friendly" | "technical";

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  greeting?: string;
}

export class AgentCapabilitiesPatchDto {
  @IsBoolean()
  @IsOptional()
  priceObjectionHandling?: boolean;

  @IsBoolean()
  @IsOptional()
  shippingObjectionHandling?: boolean;

  @IsBoolean()
  @IsOptional()
  trustReassurance?: boolean;

  @IsBoolean()
  @IsOptional()
  paymentFrictionGuidance?: boolean;

  @IsBoolean()
  @IsOptional()
  escalation?: boolean;

  @IsBoolean()
  @IsOptional()
  machineToMachineNegotiation?: boolean;
}

export class AgentGuardrailsPatchDto {
  @IsBoolean()
  @IsOptional()
  forbidUnauthorizedDiscounts?: boolean;

  @IsBoolean()
  @IsOptional()
  forbidUnauthorizedFreeShipping?: boolean;

  @IsBoolean()
  @IsOptional()
  forbidDeliveryPromisesWithoutSource?: boolean;

  @IsBoolean()
  @IsOptional()
  forbidStockPromisesWithoutSource?: boolean;

  @IsBoolean()
  @IsOptional()
  forbidPaymentStatusClaims?: boolean;

  @IsBoolean()
  @IsOptional()
  forbidLegalMedicalFinancialAdvice?: boolean;

  @IsBoolean()
  @IsOptional()
  forbidAbusivePressure?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  blockedPhrases?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  requiredDisclaimers?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  escalationTriggers?: string[];
}

export class AgentCheckoutSettingsPatchDto {
  @IsIn(["silent_until_trigger", "proactive", "manual_only"])
  @IsOptional()
  agentMode?: "silent_until_trigger" | "proactive" | "manual_only";

  @IsBoolean()
  @IsOptional()
  openWidgetOnTrigger?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  cooldownSeconds?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxInterventionsPerSession?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  triggerPreferences?: string[];

  @IsBoolean()
  @IsOptional()
  handoffEnabled?: boolean;
}

export class AgentRulesPatchDto {
  @ValidateNested()
  @Type(() => AgentIdentityPatchDto)
  @IsOptional()
  identity?: AgentIdentityPatchDto;

  @ValidateNested()
  @Type(() => AgentCapabilitiesPatchDto)
  @IsOptional()
  capabilities?: AgentCapabilitiesPatchDto;

  @ValidateNested()
  @Type(() => AgentGuardrailsPatchDto)
  @IsOptional()
  guardrails?: AgentGuardrailsPatchDto;

  @ValidateNested()
  @Type(() => AgentCheckoutSettingsPatchDto)
  @IsOptional()
  checkoutSettings?: AgentCheckoutSettingsPatchDto;
}
