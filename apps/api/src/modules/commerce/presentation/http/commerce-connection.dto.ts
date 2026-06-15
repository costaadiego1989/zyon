import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

export class ConnectCommerceDto {
  @ApiProperty({ enum: ["shopify", "woocommerce"] })
  @IsIn(["shopify", "woocommerce"])
  provider!: "shopify" | "woocommerce";

  @ApiPropertyOptional({ example: "merchant.myshopify.com" })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "shopify")
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  shop_domain?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "shopify")
  @IsString()
  @MinLength(8)
  admin_access_token?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "shopify")
  @IsString()
  @MinLength(8)
  storefront_access_token?: string;

  @ApiPropertyOptional({ example: "2026-04" })
  @IsOptional()
  @IsString()
  api_version?: string;

  @ApiPropertyOptional({ example: "https://store.example.com" })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "woocommerce")
  @IsUrl({ protocols: ["https"], require_protocol: true })
  store_url?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "woocommerce")
  @IsString()
  @MinLength(8)
  consumer_key?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "woocommerce")
  @IsString()
  @MinLength(8)
  consumer_secret?: string;
}
