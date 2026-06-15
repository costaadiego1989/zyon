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
} from "../../domain/integrations.types.js";

export class UpsertWebhookEndpointDto {
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
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}
