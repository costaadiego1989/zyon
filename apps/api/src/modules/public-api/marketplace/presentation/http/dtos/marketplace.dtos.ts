import { IsString, IsOptional, IsNumber, Min, Max, IsArray } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SearchMarketplaceDto {
  @ApiProperty({ example: "calça de couro preta" })
  @IsString()
  query!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UpdateMarketplaceConfigDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 1500, description: "100-5000 bps (1%-50%)" })
  @IsOptional()
  @IsNumber()
  commission_rate_bps?: number;

  @ApiPropertyOptional({ example: 7, description: "1-30 days" })
  @IsOptional()
  @IsNumber()
  return_window_days?: number;

  @ApiPropertyOptional({ example: 14, description: "1-30 days" })
  @IsOptional()
  @IsNumber()
  payout_delay_days?: number;

  @ApiPropertyOptional({ example: 30, description: "7-30 days" })
  @IsOptional()
  @IsNumber()
  chargeback_window_days?: number;

  @ApiPropertyOptional({ example: ["electronics", "books"] })
  @IsOptional()
  @IsArray()
  allowed_categories?: string[];

  @ApiPropertyOptional({ example: ["competitor-1", "competitor-2"] })
  @IsOptional()
  @IsArray()
  blocked_merchants?: string[];
}

export class AddCrossStoreItemDto {
  @ApiProperty()
  @IsString()
  checkout_session_id!: string;

  @ApiProperty()
  @IsString()
  seller_merchant_id!: string;

  @ApiProperty()
  @IsString()
  federated_product_id!: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 4999 })
  @IsNumber()
  @Min(0)
  unit_price_cents!: number;
}

export class PlaceCrossStoreOrderDto {
  @ApiProperty()
  @IsString()
  checkout_session_id!: string;

  @ApiProperty()
  @IsString()
  order_id!: string;
}

export class HandleChargebackDto {
  @ApiProperty()
  @IsString()
  settlement_id!: string;
}
