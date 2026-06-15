import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from "class-validator";

const TRACKING_STATUSES = [
  "label_generated",
  "dispatched",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
] as const;

class OrderTrackingEventDto {
  @IsOptional()
  @IsIn(TRACKING_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsISO8601()
  occurred_at?: string;

  @IsOptional()
  @IsObject()
  carrier_raw?: Record<string, unknown>;
}

export class UpdateOrderTrackingDto {
  @IsString()
  @MaxLength(120)
  tracking_code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  carrier?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ["https"] })
  @MaxLength(2_048)
  tracking_url?: string;

  @IsOptional()
  @IsIn(TRACKING_STATUSES)
  status?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderTrackingEventDto)
  events?: OrderTrackingEventDto[];
}
