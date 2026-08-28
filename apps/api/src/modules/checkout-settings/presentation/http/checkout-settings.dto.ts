import {
  ApiProperty,
  ApiPropertyOptional,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import type { AdvancedRule } from "@zyon/shared-types";


class ProgressiveDiscountStagesDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  initial_coupon?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  exit_intent?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  abandoned_cart?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  payment_nudge?: number;
}

class ProgressiveDiscountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ["progressive_only", "coupon_only", "both"] })
  @IsOptional()
  @IsString()
  @IsIn(["progressive_only", "coupon_only", "both"])
  mode?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  maxProgressivePercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => ProgressiveDiscountStagesDto)
  stages?: ProgressiveDiscountStagesDto;
}

class InterventionPolicyDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minimumAbandonmentScore?: number;

  @ApiPropertyOptional({ minimum: 30 })
  @IsOptional()
  @IsNumber()
  @Min(30)
  cooldownSeconds?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  maxInterventionsPerSession?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => ProgressiveDiscountDto)
  progressiveDiscount?: ProgressiveDiscountDto;
}

class WidgetBehaviorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  openWidgetOnTrigger?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  startMinimized?: boolean;

  @ApiPropertyOptional({ enum: ["bottom_right", "bottom_left", "top_right", "top_left"] })
  @IsOptional()
  @IsIn(["bottom_right", "bottom_left", "top_right", "top_left"])
  position?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  initialDelaySeconds?: number;

  @ApiPropertyOptional({ enum: ["floating", "page", "redirect"] })
  @IsOptional()
  @IsIn(["floating", "page", "redirect"])
  cartPresentationMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fabColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  inviteText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showCartBadge?: boolean;

  @ApiPropertyOptional({ enum: ["open_widget", "redirect"] })
  @IsOptional()
  @IsString()
  @IsIn(["open_widget", "redirect"])
  fabClickAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fabRedirectUrl?: string;
}

class TriggerRuleDto {
  @ApiProperty()
  @IsString()
  trigger!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  priority!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  cooldownSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  couponCode?: string;
}

class SuppressionRulesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  suppressedSteps?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  blockedRegions?: string[];

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumCartValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  suppressAfterOfferAccepted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  respectBuyerOptOut?: boolean;
}

class HandoffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minLength: 1, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];
}

export class CheckoutSettingsPatchDto {
  @ApiPropertyOptional({ enum: ["silent_until_trigger", "proactive", "manual_only"] })
  @IsOptional()
  @IsIn(["silent_until_trigger", "proactive", "manual_only"])
  mode?: "silent_until_trigger" | "proactive" | "manual_only";

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetBehaviorDto)
  widgetBehavior?: WidgetBehaviorDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => InterventionPolicyDto)
  interventionPolicy?: InterventionPolicyDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TriggerRuleDto)
  triggerRules?: TriggerRuleDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => SuppressionRulesDto)
  suppressionRules?: SuppressionRulesDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => HandoffDto)
  handoff?: HandoffDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  advancedRules?: AdvancedRule[];
}

export class WidgetConfigDto {
  @ApiProperty({ enum: ["silent_until_trigger", "proactive", "manual_only"] })
  mode!: "silent_until_trigger" | "proactive" | "manual_only";

  @ApiPropertyOptional({ enum: ["bottom_right", "bottom_left", "top_right", "top_left"] })
  position?: string;

  @ApiPropertyOptional()
  fabColor?: string;

  @ApiPropertyOptional()
  inviteText?: string;

  @ApiPropertyOptional()
  presentationMode?: string;

  @ApiPropertyOptional()
  startMinimized?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  initialDelaySeconds?: number;

  @ApiPropertyOptional()
  showCartBadge?: boolean;

  @ApiPropertyOptional()
  fabClickAction?: string;

  @ApiPropertyOptional()
  fabRedirectUrl?: string;

  @ApiPropertyOptional({ enum: ["floating", "page", "redirect"] })
  cartPresentationMode?: string;

  @ApiPropertyOptional()
  budgetModeEnabled?: boolean;

  @ApiProperty()
  openWidgetOnTrigger!: boolean;

  @ApiProperty({ type: [String] })
  enabledTriggers!: string[];

  @ApiPropertyOptional({ description: "Trigger-specific messages and coupon codes" })
  triggerMessages?: Record<string, { message?: string; couponCode?: string }>;

  @ApiProperty({ type: [String] })
  suppressedSteps!: string[];

  @ApiProperty({ type: [String] })
  blockedRegions!: string[];

  @ApiPropertyOptional({ minimum: 0 })
  minimumCartValue?: number;

  @ApiProperty()
  handoffEnabled!: boolean;

  @ApiProperty()
  handoffMessage!: string;

  @ApiProperty({ type: [String] })
  handoffChannels!: string[];

  @ApiPropertyOptional({ minimum: 30 })
  cooldownSeconds?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  maxInterventionsPerSession?: number;

  @ApiPropertyOptional({ minimum: 10, description: "Seconds of inactivity before idle trigger fires" })
  idleSeconds?: number;

  @ApiPropertyOptional({ description: "Progressive discount config (enabled + per-stage percents)" })
  progressiveDiscount?: {
    enabled: boolean;
    stages: Record<string, number>;
  };
}
