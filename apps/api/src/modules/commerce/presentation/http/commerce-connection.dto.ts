import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

export class ConnectCommerceDto {
  @ApiProperty({ enum: ["shopify", "woocommerce", "nuvemshop", "tray", "vtex"] })
  @IsIn(["shopify", "woocommerce", "nuvemshop", "tray", "vtex"])
  provider!: "shopify" | "woocommerce" | "nuvemshop" | "tray" | "vtex";

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
  @IsUrl({ protocols: ["https", "http"], require_protocol: true, require_tld: false })
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

  @ApiPropertyOptional({ writeOnly: true, description: "Webhook secret. Shopify uses the app client_secret; WooCommerce falls back to consumer_secret when omitted." })
  @ValidateIf((value: ConnectCommerceDto) => (value.provider === "woocommerce" || value.provider === "shopify") && value.webhook_secret !== undefined)
  @IsOptional()
  @IsString()
  @MinLength(8)
  webhook_secret?: string;

  // --- Nuvemshop (Tiendanube) ---
  @ApiPropertyOptional({ example: "1234567" })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "nuvemshop")
  @IsString()
  @Matches(/^\d+$/)
  store_id?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "nuvemshop")
  @IsString()
  @MinLength(20)
  access_token?: string;

  @ApiPropertyOptional({ example: "AACP (https://aacp.example)" })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "nuvemshop")
  @IsOptional()
  @IsString()
  @MaxLength(200)
  user_agent?: string;

  // --- Tray Commerce ---
  @ApiPropertyOptional({ example: "https://store.com.br/web_api" })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "tray")
  @IsUrl({ protocols: ["https"], require_protocol: true })
  api_address?: string;

  @ApiPropertyOptional({ writeOnly: true, minLength: 20 })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "tray")
  @IsString()
  @MinLength(20)
  tray_access_token?: string;

  @ApiPropertyOptional({ writeOnly: true, minLength: 20 })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "tray")
  @IsString()
  @MinLength(20)
  tray_refresh_token?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "tray")
  @IsString()
  tray_consumer_key?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "tray")
  @IsString()
  tray_consumer_secret?: string;

  @ApiPropertyOptional({ example: "1720000000" })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "tray")
  @IsString()
  @Matches(/^\d+$/)
  tray_access_token_expires_at?: string;

  // --- VTEX ---
  @ApiPropertyOptional({ example: "mystorename" })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "vtex")
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  account_name?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "vtex")
  @IsString()
  @MinLength(8)
  app_key?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @ValidateIf((value: ConnectCommerceDto) => value.provider === "vtex")
  @IsString()
  @MinLength(8)
  app_token?: string;
}
