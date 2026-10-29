import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PackageDimensionsDto {
  @ApiProperty({ example: 0.5, description: 'Weight in kg' })
  @IsNumber()
  @Min(0)
  weight_kg!: number;

  @ApiProperty({ example: 10, description: 'Height in cm' })
  @IsNumber()
  @Min(0)
  height_cm!: number;

  @ApiProperty({ example: 20, description: 'Width in cm' })
  @IsNumber()
  @Min(0)
  width_cm!: number;

  @ApiProperty({ example: 30, description: 'Length in cm' })
  @IsNumber()
  @Min(0)
  length_cm!: number;

  @ApiProperty({ example: 1, description: 'Number of packages with these dimensions' })
  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class ShippingQuoteItemDto {
  @ApiProperty({ example: 'SKU-001' })
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class GetShippingQuotesDto {
  @ApiProperty({ example: 'sess_abc123', description: 'Checkout session ID' })
  @IsString()
  @IsNotEmpty()
  session_id!: string;

  @ApiProperty({ example: '01310-100', description: 'Destination ZIP/postal code' })
  @IsString()
  @IsNotEmpty()
  destination_zip!: string;

  @ApiProperty({ example: 149.90, description: 'Cart total in currency units (e.g. BRL)' })
  @IsNumber()
  @Min(0)
  cart_total!: number;

  @ApiPropertyOptional({ example: '04538-132', description: 'Origin ZIP (warehouse)' })
  @IsOptional()
  @IsString()
  origin_zip?: string;

  @ApiPropertyOptional({ type: [PackageDimensionsDto], description: 'Package dimensions for accurate quotes' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageDimensionsDto)
  packages?: PackageDimensionsDto[];

  @ApiPropertyOptional({ type: [ShippingQuoteItemDto], description: 'Cart items for SKU-level quote accuracy' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShippingQuoteItemDto)
  items?: ShippingQuoteItemDto[];
}

export class ShippingQuoteOptionResponse {
  @ApiProperty({ example: 'correios' })
  carrier_key!: string;

  @ApiProperty({ example: 'Correios PAC' })
  label!: string;

  @ApiProperty({ example: 2990, description: 'Price in minor currency units (e.g. cents)' })
  price_minor!: number;

  @ApiProperty({ example: 3, description: 'Estimated delivery time in business days' })
  eta_days!: number;

  @ApiProperty({ example: false })
  is_free!: boolean;
}

export class ShippingQuoteResponse {
  @ApiProperty({ example: 'quote_abc123' })
  id!: string;

  @ApiProperty({ example: 'sess_abc123' })
  session_id!: string;

  @ApiProperty({ example: 'mch_xyz789' })
  merchant_id!: string;

  @ApiProperty({ example: '01310-100' })
  destination_zip!: string;

  @ApiProperty({ example: 'quote_key_12345' })
  quote_key!: string;

  @ApiProperty({ type: [ShippingQuoteOptionResponse] })
  options!: ShippingQuoteOptionResponse[];

  @ApiProperty({ example: '2024-08-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-08-15T11:30:00Z' })
  expires_at!: string;
}
