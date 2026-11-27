import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
  Matches,
  IsISO8601,
} from "class-validator";
import {
  MARKETING_STAGES,
  type MarketingStage,
  type MarketingOrigin,
  type MarketingChannel,
} from "../domain/marketing.js";
export class MarketingContactQueryDto {
  @IsOptional() @IsString() @Length(0, 200) search?: string;
  @IsOptional() @IsIn(["site", "whatsapp"]) channel?: MarketingChannel;
  @IsOptional() @IsIn(MARKETING_STAGES) stage?: MarketingStage;
  @IsOptional() @IsIn(["site", "whatsapp", "unknown"]) origin?: MarketingOrigin;
  @IsOptional() @IsIn(["lead", "customer"]) buyer?: "lead" | "customer";
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset = 0;
}
export class MarketingVersionDto {
  @IsInt() @Min(0) version!: number;
}
export class MarketingConversationQueryDto {
  @IsOptional() @IsString() @Length(0, 200) search?: string;
  @IsOptional() @IsIn(["site", "whatsapp"]) channel?: MarketingChannel;
  @IsOptional() @IsIn(["ai", "human"]) mode?: "ai" | "human";
  @IsOptional() @IsIn(["mine", "unassigned"]) assignment?:
    | "mine"
    | "unassigned";
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset = 0;
}
export class MarketingMessagesQueryDto {
  @IsOptional() @IsString() @Length(1, 300) before?: string;
}
export class MarketingStageDto extends MarketingVersionDto {
  @IsIn(MARKETING_STAGES) stage!: MarketingStage;
  @IsString() @Length(1, 500) reason!: string;
}
export class MarketingOwnershipDto extends MarketingVersionDto {
  @IsIn(["claim", "release"]) action!: "claim" | "release";
}
export class MarketingReplyDto extends MarketingVersionDto {
  @IsString() @Length(1, 4000) content!: string;
  @IsString() @Length(1, 128) requestId!: string;
}
export class MarketingSegmentDto {
  @IsOptional() @IsIn(MARKETING_STAGES) stage?: MarketingStage;
  @IsOptional() @IsIn(["site", "whatsapp", "unknown"]) origin?: MarketingOrigin;
  @IsOptional() @IsIn(["lead", "customer"]) buyer?: "lead" | "customer";
  @IsOptional() @IsString() @Length(1, 120) interest?: string;
}
export class MarketingCampaignDto {
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(1, 1024) body!: string;
  @ValidateNested()
  @Type(() => MarketingSegmentDto)
  segment: MarketingSegmentDto = {};
  @IsInt() @Min(1) @Max(2147483647) budgetCents!: number;
  @IsInt() @Min(1) @Max(2147483647) maxUnitCostCents!: number;
  @IsOptional() @Matches(/^[a-z]{2}_[A-Z]{2}$/) language?: string;
}
export class MarketingUpdateCampaignDto extends MarketingCampaignDto {
  @IsInt() @Min(1) version!: number;
}
export class MarketingScheduleDto {
  @IsOptional() @IsISO8601() scheduledAt?: string;
}
export class MarketingSettingsDto {
  @IsString() @Length(1, 100) timezone!: string;
  @IsInt() @Min(0) @Max(23) startHour!: number;
  @IsInt() @Min(1) @Max(24) endHour!: number;
  @IsInt() @Min(1) @Max(8760) minIntervalHours!: number;
  @IsInt() @Min(1) @Max(100) maxMessagesPerDay!: number;
  @IsInt() @Min(1) @Max(3650) retentionDays!: number;
}
