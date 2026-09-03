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
    example: "2026-09-03T00:00:00.000Z",
    description: "Timestamp when this discovery document was generated",
  })
  created_at!: string;
}
