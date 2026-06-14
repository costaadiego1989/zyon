import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  TENANT_API_SCOPES,
  type TenantApiScope,
} from "../../../../shared/auth/tenant-principal.js";
import type { MerchantApiKeyEnvironment } from "../../domain/integrations.types.js";

export class CreateMerchantApiKeyDto {
  @ApiPropertyOptional({ example: "ERP production" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    enum: TENANT_API_SCOPES,
    isArray: true,
    example: ["orders:read", "orders:write", "tracking:write"],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(TENANT_API_SCOPES, { each: true })
  scopes?: TenantApiScope[];

  @ApiPropertyOptional({ enum: ["test", "live"], default: "test" })
  @IsOptional()
  @IsIn(["test", "live"])
  environment?: MerchantApiKeyEnvironment;

  @ApiPropertyOptional({
    name: "expires_at",
    example: "2027-06-14T00:00:00.000Z",
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  expires_at?: string;

  @ApiPropertyOptional({
    name: "allowed_cidrs",
    isArray: true,
    example: ["203.0.113.10/32", "2001:db8::/48"],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  allowed_cidrs?: string[];
}

export class RotateMerchantApiKeyDto {
  @ApiPropertyOptional({
    name: "overlap_seconds",
    default: 300,
    minimum: 0,
    maximum: 86400,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  overlap_seconds?: number;
}
