import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min
} from "class-validator";

export class UpdateMerchantRulesDto {
  @IsInt()
  @Min(0)
  @Max(50)
  @IsOptional()
  maxDiscountPercent?: number;

  @IsInt()
  @Min(0)
  @Max(80)
  @IsOptional()
  minimumMarginPercent?: number;

  @IsInt()
  @Min(0)
  @Max(500)
  @IsOptional()
  maxShippingSubsidy?: number;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  maxPartialShippingDiscount?: number;

  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  freeShippingMinCartValue?: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  @IsOptional()
  offerExpirationMinutes?: number;

  @IsBoolean()
  @IsOptional()
  allowFreeShipping?: boolean;

  @IsBoolean()
  @IsOptional()
  allowShippingDiscount?: boolean;

  @IsBoolean()
  @IsOptional()
  allowBonusItem?: boolean;

  @IsBoolean()
  @IsOptional()
  allowStackDiscountAndFreeShipping?: boolean;

  @IsBoolean()
  @IsOptional()
  couponBoxEnabled?: boolean;

  @IsIn(["consultative", "aggressive", "premium", "young", "technical", "popular"])
  @IsOptional()
  brandVoice?: "consultative" | "aggressive" | "premium" | "young" | "technical" | "popular";

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  blockedRegions?: string[];
}
