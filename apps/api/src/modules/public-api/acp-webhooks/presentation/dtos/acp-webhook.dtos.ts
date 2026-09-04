import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";
import { ACP_ORDER_EVENT_TYPES } from "../../acp-webhook-event.types.js";

export class CreateAcpWebhookSubscriptionDto {
  @ApiProperty({
    example: "https://example.com/webhooks/acp",
    description: "Subscriber URL — HTTP/HTTPS endpoint that will receive events.",
  })
  @IsString()
  @IsNotEmpty()
  url!: string;

  @ApiProperty({
    type: [String],
    enum: ACP_ORDER_EVENT_TYPES,
    example: ["order.created", "order.updated", "order.fulfilled"],
    description: "Event types to subscribe to. At least one required.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ACP_ORDER_EVENT_TYPES, { each: true })
  events!: string[];

  @ApiPropertyOptional({
    description:
      "Optional explicit tenant. When omitted, the merchant must be supplied via the X-AACP-Merchant-Id header.",
    example: "mrc_abc123",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  merchant_id?: string;
}

export class AcpWebhookSubscriptionViewDto {
  @ApiProperty({ example: "sub_a1b2c3d4e5f6" })
  subscription_id!: string;

  @ApiProperty({ example: "https://example.com/webhooks/acp" })
  url!: string;

  @ApiProperty({
    type: [String],
    enum: ACP_ORDER_EVENT_TYPES,
    example: ["order.created"],
  })
  events!: string[];

  @ApiProperty({ example: "2026-09-03T12:00:00.000Z" })
  created_at!: string;
}

export class AcpWebhookSubscriptionCreatedDto extends AcpWebhookSubscriptionViewDto {
  @ApiProperty({
    example: "whsec_Abc...0123",
    description:
      "Plaintext HMAC signing secret — RETURNED ONCE on creation. Store securely; subsequent reads only expose the subscription_id.",
  })
  secret!: string;
}

export class AcpWebhookListResponseDto {
  @ApiProperty({ type: [AcpWebhookSubscriptionViewDto] })
  data!: AcpWebhookSubscriptionViewDto[];
}

export class AcpWebhookDeleteResponseDto {
  @ApiProperty({ example: true })
  deleted!: boolean;

  @ApiProperty({ example: "sub_a1b2c3d4e5f6" })
  subscription_id!: string;
}
