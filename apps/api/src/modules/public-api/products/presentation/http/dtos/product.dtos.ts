import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  IsIn,
  IsUrl,
  ArrayMinSize,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProductVariantMediaDto {
  @ApiProperty({ example: 'https://cdn.example.com/img.jpg' })
  @IsString()
  @IsUrl({ require_tld: false })
  url!: string;

  @ApiProperty({ enum: ['IMAGE', 'VIDEO'], example: 'IMAGE' })
  @IsIn(['IMAGE', 'VIDEO'])
  type!: 'IMAGE' | 'VIDEO';

  @ApiPropertyOptional({ example: 'Front view' })
  @IsOptional()
  @IsString()
  alt?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  order?: number;
}

export class ProductVariantInputDto {
  @ApiProperty({ example: 'SKU-001' })
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @ApiProperty({ example: 4990, description: 'Price in cents' })
  @IsNumber()
  @Min(0)
  base_price_in_cents!: number;

  @ApiPropertyOptional({ example: 2000, description: 'Cost in cents' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost_in_cents?: number;

  @ApiPropertyOptional({ example: 'BRL' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stock_quantity?: number;

  @ApiPropertyOptional({ example: 300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weight_grams?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  length_cm?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  width_cm?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  height_cm?: number;

  @ApiPropertyOptional({ example: 8.5, description: 'Tax percent (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tax_percent?: number;

  @ApiPropertyOptional({ example: '7891234567890' })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({
    example: { color: 'blue', size: 'M' },
    description: 'Variant attributes (e.g. size, color)',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ type: [ProductVariantMediaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantMediaDto)
  media?: ProductVariantMediaDto[];
}

export class CreateProductDto {
  @ApiProperty({ example: 'Premium T-Shirt' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'High quality cotton t-shirt' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'physical' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 'cat_abc123' })
  @IsOptional()
  @IsString()
  category_id?: string;

  @ApiPropertyOptional({
    example: { brand: 'Acme', collection: 'summer-2026' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'Premium Cotton Tee' })
  @IsOptional()
  @IsString()
  seo_title?: string;

  @ApiPropertyOptional({ example: 'Soft, breathable cotton t-shirt.' })
  @IsOptional()
  @IsString()
  meta_description?: string;

  @ApiPropertyOptional({ example: 'premium-cotton-tee' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ example: 'Premium Tee — Acme' })
  @IsOptional()
  @IsString()
  og_title?: string;

  @ApiPropertyOptional({ example: 'Soft cotton tee for everyday wear.' })
  @IsOptional()
  @IsString()
  og_description?: string;

  @ApiPropertyOptional({ example: 'summary_large_image' })
  @IsOptional()
  @IsString()
  twitter_card?: string;

  @ApiPropertyOptional({ example: ['cotton', 't-shirt', 'premium'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiProperty({ type: [ProductVariantInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInputDto)
  variants!: ProductVariantInputDto[];
}

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Updated T-Shirt Name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'physical' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 'cat_abc123' })
  @IsOptional()
  @IsString()
  category_id?: string;

  @ApiPropertyOptional({ example: { brand: 'Acme' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ example: 'Premium Cotton Tee' })
  @IsOptional()
  @IsString()
  seo_title?: string;

  @ApiPropertyOptional({ example: 'Soft cotton tee.' })
  @IsOptional()
  @IsString()
  meta_description?: string;

  @ApiPropertyOptional({ example: 'premium-cotton-tee' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ example: 'Premium Tee — Acme' })
  @IsOptional()
  @IsString()
  og_title?: string;

  @ApiPropertyOptional({ example: 'Soft cotton tee.' })
  @IsOptional()
  @IsString()
  og_description?: string;

  @ApiPropertyOptional({ example: 'summary_large_image' })
  @IsOptional()
  @IsString()
  twitter_card?: string;

  @ApiPropertyOptional({ example: ['cotton', 'tee'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}
