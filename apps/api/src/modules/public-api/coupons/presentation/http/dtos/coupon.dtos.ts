import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsIn,
  Min,
} from 'class-validator';

export class CreateCouponDto {
  @ApiProperty({ example: 'SUMMER20' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({
    enum: ['percent', 'fixed', 'shipping_free', 'shipping_percent', 'shipping_fixed'],
    example: 'percent',
  })
  @IsIn(['percent', 'fixed', 'shipping_free', 'shipping_percent', 'shipping_fixed'])
  discount_type!: string;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @Min(0)
  discount_value!: number;

  @ApiPropertyOptional({ example: 10000, description: 'Minimum cart total in cents' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  min_cart_total?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  max_usages?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  max_per_buyer?: number;

  @ApiPropertyOptional({ example: ['SKU-001', 'SKU-002'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_skus?: string[];

  @ApiPropertyOptional({ example: ['SKU-EXCLUDED'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blocked_skus?: string[];

  @ApiPropertyOptional({ example: ['BR', 'US'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_regions?: string[];

  @ApiPropertyOptional({ example: ['AR'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blocked_regions?: string[];

  @ApiProperty({ example: '2024-06-01T00:00:00Z' })
  @IsString()
  @IsNotEmpty()
  starts_at!: string;

  @ApiPropertyOptional({ example: '2024-08-31T23:59:59Z' })
  @IsOptional()
  @IsString()
  ends_at?: string;
}

export class UpdateCouponDto {
  @ApiPropertyOptional({
    enum: ['percent', 'fixed', 'shipping_free', 'shipping_percent', 'shipping_fixed'],
    example: 'percent',
  })
  @IsOptional()
  @IsIn(['percent', 'fixed', 'shipping_free', 'shipping_percent', 'shipping_fixed'])
  discount_type?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount_value?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  min_cart_total?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  max_usages?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  max_per_buyer?: number;

  @ApiPropertyOptional({ example: ['SKU-001'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_skus?: string[];

  @ApiPropertyOptional({ example: ['SKU-X'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blocked_skus?: string[];

  @ApiPropertyOptional({ example: ['BR', 'MX'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_regions?: string[];

  @ApiPropertyOptional({ example: ['AR'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blocked_regions?: string[];

  @ApiPropertyOptional({ example: '2024-07-01T00:00:00Z' })
  @IsOptional()
  @IsString()
  starts_at?: string;

  @ApiPropertyOptional({ example: '2024-09-30T23:59:59Z' })
  @IsOptional()
  @IsString()
  ends_at?: string;
}

export class ValidateCouponDto {
  @ApiProperty({ example: 'SUMMER20' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ example: 15000, description: 'Cart total in cents' })
  @IsNumber()
  @Min(0)
  cart_value!: number;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  buyer_region?: string;
}

export class CouponResponse {
  id!: string;
  code!: string;
  merchant_id!: string;
  discount_type!: string;
  discount_value!: number;
  min_cart_total!: number | null;
  max_usages!: number | null;
  max_per_buyer!: number | null;
  usages_count!: number;
  allowed_skus!: string[];
  blocked_skus!: string[];
  allowed_regions!: string[];
  blocked_regions!: string[];
  status!: string;
  starts_at!: string;
  ends_at!: string | null;
  created_at!: string;
  updated_at!: string;
}

export class CouponValidationResponse {
  valid!: boolean;
  reason?: string;
  discount_value?: number;
  discount_type?: string;
}
