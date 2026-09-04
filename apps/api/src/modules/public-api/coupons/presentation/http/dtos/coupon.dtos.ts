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
  @ApiProperty({ example: 'cpn_abc123', description: 'Coupon ID' })
  id!: string;

  @ApiProperty({ example: 'SUMMER20', description: 'Coupon code' })
  code!: string;

  @ApiProperty({ example: 'mch_xyz789', description: 'Owner merchant ID' })
  merchant_id!: string;

  @ApiProperty({
    enum: ['percent', 'fixed', 'shipping_free', 'shipping_percent', 'shipping_fixed'],
    example: 'percent',
  })
  discount_type!: string;

  @ApiProperty({ example: 20, description: 'Discount amount (percent or cents)' })
  discount_value!: number;

  @ApiPropertyOptional({ example: 10000, description: 'Minimum cart total in cents' })
  min_cart_total!: number | null;

  @ApiPropertyOptional({ example: 100, description: 'Maximum total usages allowed' })
  max_usages!: number | null;

  @ApiPropertyOptional({ example: 5, description: 'Maximum usages per buyer' })
  max_per_buyer!: number | null;

  @ApiProperty({ example: 42, description: 'Current total usage count' })
  usages_count!: number;

  @ApiProperty({ example: ['SKU-001', 'SKU-002'], description: 'SKUs this coupon applies to' })
  allowed_skus!: string[];

  @ApiProperty({ example: ['SKU-EXCLUDED'], description: 'SKUs excluded from this coupon' })
  blocked_skus!: string[];

  @ApiProperty({ example: ['BR', 'US'], description: 'Regions where coupon is valid' })
  allowed_regions!: string[];

  @ApiProperty({ example: ['AR'], description: 'Regions where coupon is blocked' })
  blocked_regions!: string[];

  @ApiProperty({ enum: ['active', 'archived', 'expired'], example: 'active' })
  status!: string;

  @ApiProperty({ example: '2024-06-01T00:00:00Z' })
  starts_at!: string;

  @ApiPropertyOptional({ example: '2024-08-31T23:59:59Z' })
  ends_at!: string | null;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string;
}

export class CouponValidationResponse {
  @ApiProperty({ example: true, description: 'Whether the coupon is valid for the given cart' })
  valid!: boolean;

  @ApiPropertyOptional({ example: 'coupon_expired', description: 'Reason if invalid' })
  reason?: string;

  @ApiPropertyOptional({ example: 2000, description: 'Calculated discount amount in cents' })
  discount_value?: number;

  @ApiPropertyOptional({
    enum: ['percent', 'fixed', 'shipping_free', 'shipping_percent', 'shipping_fixed'],
    example: 'percent',
  })
  discount_type?: string;
}
