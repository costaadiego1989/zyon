import {
  ApiProperty,
  ApiPropertyOptional,
} from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from "class-validator";
import {
  TENANT_WEBHOOK_EVENTS,
  type TenantWebhookEventType,
} from "../../../../../integrations/domain/integrations.types.js";

export class CreateWebhookDto {
  @ApiProperty({ example: "https://erp.example.com/webhooks/aacp" })
  @IsUrl({ protocols: ["https"], require_protocol: true })
  url!: string;

  @ApiPropertyOptional({
    enum: TENANT_WEBHOOK_EVENTS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TENANT_WEBHOOK_EVENTS.length)
  @IsString({ each: true })
  events?: TenantWebhookEventType[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class UpdateWebhookDto {
  @ApiProperty({ example: "https://erp.example.com/webhooks/aacp" })
  @IsUrl({ protocols: ["https"], require_protocol: true })
  url!: string;

  @ApiPropertyOptional({
    enum: TENANT_WEBHOOK_EVENTS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TENANT_WEBHOOK_EVENTS.length)
  @IsString({ each: true })
  events?: TenantWebhookEventType[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class TestWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  event_type?: TenantWebhookEventType;
}

export class WebhookResponse {
  @ApiProperty({ example: 'wh_abc123', description: 'Webhook endpoint ID' })
  id!: string;

  @ApiProperty({ example: 'https://erp.example.com/webhooks/aacp' })
  url!: string;

  @ApiProperty({ example: true, description: 'Whether webhook is active' })
  active!: boolean;

  @ApiProperty({
    enum: TENANT_WEBHOOK_EVENTS,
    isArray: true,
    example: ['order_created', 'order_updated'],
  })
  events!: TenantWebhookEventType[];

  @ApiPropertyOptional({ example: 'Production ERP sync' })
  description!: string | null;

  @ApiPropertyOptional({
    example: 'secret_xxxxxxxxxxxx',
    description: 'Signing secret (only shown at creation)',
  })
  secret_key!: string | undefined;

  @ApiProperty({ example: 'secret_xxxx...xxxx', description: 'Masked secret hint' })
  secret_key_hint!: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string;
}

export class WebhookDeliveryResponse {
  @ApiProperty({ example: 'del_abc123', description: 'Delivery record ID' })
  id!: string;

  @ApiProperty({ example: 'wh_abc123', description: 'Webhook endpoint ID' })
  webhook_id!: string;

  @ApiProperty({ example: 'https://erp.example.com/webhooks/aacp' })
  webhook_url!: string;

  @ApiProperty({ example: 'evt_xyz789', description: 'Event ID' })
  event_id!: string;

  @ApiProperty({ enum: TENANT_WEBHOOK_EVENTS, example: 'order_created' })
  event_type!: TenantWebhookEventType;

  @ApiProperty({ enum: ['pending', 'delivered', 'failed'], example: 'delivered' })
  status!: string;

  @ApiProperty({ example: 1, description: 'Number of delivery attempts' })
  attempts!: number;

  @ApiPropertyOptional({ example: '2024-02-20T14:50:00Z', description: 'When next retry is scheduled' })
  next_attempt_at!: string | null;

  @ApiPropertyOptional({ example: 200, description: 'HTTP response status from endpoint' })
  response_status!: number | null;

  @ApiPropertyOptional({ example: '{"status":"ok"}', description: 'HTTP response body from endpoint' })
  response_body!: string | null;

  @ApiPropertyOptional({ example: 'Connection timeout after 30s' })
  error!: string | null;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-02-20T14:45:35Z' })
  updated_at!: string;

  @ApiPropertyOptional({ example: '2024-02-20T14:45:35Z', description: 'When delivery succeeded' })
  delivered_at!: string | null;
}
