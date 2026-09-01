import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
  IsNumber
} from "class-validator";
import { Type } from "class-transformer";

class CryptoPaymentsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(["polygon", "base"])
  chain!: "polygon" | "base";

  @IsIn(["mainnet", "testnet"])
  network!: "mainnet" | "testnet";

  @IsString()
  treasuryAddress!: string;

  @IsIn(["USDC"])
  token!: "USDC";

  @IsInt()
  @Min(60)
  @Max(3600)
  quoteTtlSeconds!: number;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  brlPerUsdc?: number;
}

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

  @IsBoolean()
  @IsOptional()
  autonomousEngineEnabled?: boolean;

  @IsIn(["consultative", "aggressive", "premium", "young", "technical", "popular"])
  @IsOptional()
  brandVoice?: "consultative" | "aggressive" | "premium" | "young" | "technical" | "popular";

  @IsString()
  @Matches(/^\d{5}(-\d{3})?$/, { message: "originZip must be a valid Brazilian CEP (12345-678 or 12345678)" })
  @IsOptional()
  originZip?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  blockedRegions?: string[];

  @IsOptional()
  policies?: {
    privacyUrl?: string;
    termsUrl?: string;
    refundUrl?: string;
    shippingUrl?: string;
  };

  @ValidateNested()
  @Type(() => CryptoPaymentsDto)
  @IsOptional()
  cryptoPayments?: CryptoPaymentsDto;
}
