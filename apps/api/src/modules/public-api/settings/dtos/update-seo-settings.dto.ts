import {
  ApiPropertyOptional,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  IsArray,
  Matches,
  IsIn,
} from "class-validator";

class SeoSettingsDto {
  @ApiPropertyOptional({ maxLength: 70 })
  @IsOptional()
  @IsString()
  @MaxLength(70)
  title?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @ApiPropertyOptional({ maxLength: 70 })
  @IsOptional()
  @IsString()
  @MaxLength(70)
  ogTitle?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  ogDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ogImage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({ enum: ["summary", "summary_large_image"] })
  @IsOptional()
  @IsIn(["summary", "summary_large_image"])
  twitterCard?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  robots?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  canonical?: string;
}

class GtmPixelIdsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  facebook?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tiktok?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  snapchat?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pinterest?: string;
}

class GtmSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^GTM-[A-Z0-9]+$/i)
  gtmId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^G-[A-Z0-9]+$/i)
  gaTrackingId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => GtmPixelIdsDto)
  pixelIds?: GtmPixelIdsDto;
}

export class UpdateSeoSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => SeoSettingsDto)
  seo?: SeoSettingsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => GtmSettingsDto)
  gtm?: GtmSettingsDto;
}
