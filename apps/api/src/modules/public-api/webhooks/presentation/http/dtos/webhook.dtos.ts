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

export interface WebhookResponse {
  id: string;
  url: string;
  active: boolean;
  events: TenantWebhookEventType[];
  description: string | null;
  secret_key: string | undefined;
  secret_key_hint: string;
  created_at: string;
  updated_at: string;
}

export interface WebhookDeliveryResponse {
  id: string;
  webhook_id: string;
  webhook_url: string;
  event_id: string;
  event_type: TenantWebhookEventType;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
}
