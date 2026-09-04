import { ApiProperty } from "@nestjs/swagger";

export class UcpDiscoveryDto {
  @ApiProperty({ example: "1.0", description: "Discovery document version" })
  version!: string;

  @ApiProperty({ example: "AACP", description: "Platform name" })
  name!: string;

  @ApiProperty({
    example: "platform-default",
    description: "Merchant/tenant identifier this discovery document describes",
  })
  merchant_id!: string;

  @ApiProperty({
    example: "Casa Decoração",
    description: "Display name of the resolved merchant (or `AACP` for platform default)",
  })
  merchant_name!: string;

  @ApiProperty({
    example: "https://casa-decorao.zyon-payments.com.br",
    description: "Canonical storefront URL for the resolved merchant",
  })
  merchant_url!: string;

  @ApiProperty({
    example: "/robots.txt",
    description: "Path to the merchant-specific robots.txt",
  })
  robots_txt_url!: string;

  @ApiProperty({
    type: [String],
    example: ["checkout", "product_discovery", "payment"],
    description: "Supported ACP/UCP capabilities",
  })
  capabilities!: string[];

  @ApiProperty({
    type: [String],
    example: ["acp", "ucp", "ap2"],
    description: "Supported agentic commerce protocols",
  })
  supported_protocols!: string[];

  @ApiProperty({
    example: "/v1/acp/checkout_sessions",
    description: "Endpoint for creating and managing checkout sessions",
  })
  checkout_sessions_endpoint!: string;

  @ApiProperty({
    example: "/v1/acp/products/feed",
    description: "Endpoint for the product catalog feed",
  })
  feed_endpoint!: string;

  @ApiProperty({
    example: "/v1/acp/webhooks",
    description: "Endpoint for registering event webhooks",
  })
  webhook_endpoint!: string;

  @ApiProperty({
    example: "https://cdn.example.com/loja/logo.png",
    required: false,
    description: "Optional merchant logo URL (from storeSettings.styles.logoUrl)",
  })
  logo_url?: string;

  @ApiProperty({
    example: "suporte@lojateste.com.br",
    required: false,
    description: "Optional merchant support email (from storeSettings.company.email)",
  })
  support_email?: string;

  @ApiProperty({
    type: [String],
    example: ["BRL", "USD"],
    required: false,
    description: "Optional list of supported currency codes",
  })
  currencies?: string[];

  @ApiProperty({
    example: "2026-09-03T00:00:00.000Z",
    description: "Timestamp when this discovery document was generated",
  })
  created_at!: string;
}
