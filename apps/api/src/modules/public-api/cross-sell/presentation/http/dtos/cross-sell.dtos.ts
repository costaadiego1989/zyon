import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PromotionTriggerDto {
  @ApiPropertyOptional({
    example: ['SKU-123', 'SKU-456'],
    description: 'Trigger if any of these SKUs are in cart',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sku_in_cart?: string[];

  @ApiPropertyOptional({
    example: ['cat_001', 'cat_002'],
    description: 'Trigger if any of these categories are in cart',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  category_in_cart?: string[];

  @ApiPropertyOptional({
    example: 50.0,
    description: 'Trigger if cart total exceeds this amount',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cart_total_above?: number;
}

export class CreateCrossSellDto {
  @ApiProperty({
    example: 'Summer Cross-Sell Bundle',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Promotion trigger conditions',
  })
  @ValidateNested()
  @Type(() => PromotionTriggerDto)
  trigger!: PromotionTriggerDto;

  @ApiProperty({
    example: ['SKU-789', 'SKU-999'],
    description: 'SKUs recommended when promotion triggers',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  recommended_skus!: string[];

  @ApiProperty({
    example: 15,
    description: 'Discount percentage to apply',
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  discount_percent!: number;

  @ApiProperty({
    example: 20,
    description: 'Maximum discount cap',
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  max_discount_percent!: number;

  @ApiProperty({
    example: '2026-09-01T00:00:00Z',
    description: 'ISO 8601 start date',
  })
  @IsString()
  @IsNotEmpty()
  starts_at!: string;

  @ApiPropertyOptional({
    example: '2026-09-30T23:59:59Z',
    description: 'ISO 8601 end date (optional)',
  })
  @IsOptional()
  @IsString()
  ends_at?: string;
}
