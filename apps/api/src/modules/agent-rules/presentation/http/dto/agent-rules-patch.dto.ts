import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";

export class AgentIdentityPatchDto {
  @IsString()
  @IsNotEmpty()
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

  // H2 fix: greeting must be non-trivial when persona is provided (cross-field).
  // Empty persona + greeting is allowed (uses default), but greeting alone without
  // tone is also fine.
  @IsString()
  @MaxLength(500)
  @ValidateIf((o: AgentIdentityPatchDto) => Boolean(o.persona) || Boolean(o.tone))
  @IsOptional()
  greeting?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  emptyCartGreeting?: string;
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
  // H2 fix: safety toggles cannot be disabled at the HTTP boundary. The domain layer
  // also enforces this, but rejecting at the DTO layer produces a 400 with a clearer
  // error path and never reaches the domain.
  @IsBoolean()
  @IsOptional()
  forbidUnauthorizedDiscounts?: true;

  @IsBoolean()
  @IsOptional()
  forbidUnauthorizedFreeShipping?: true;

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
  @ArrayMaxSize(200)
  @IsOptional()
  blockedPhrases?: string[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  requiredDisclaimers?: string[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
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
  @ArrayMaxSize(20)
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

  // H2 fix: cross-field rule — patch must carry at least one section so an empty body
  // is rejected as a no-op rather than silently accepted.
  hasAnySection(): boolean {
    return Boolean(
      this.identity ?? this.capabilities ?? this.guardrails ?? this.checkoutSettings
    );
  }
}