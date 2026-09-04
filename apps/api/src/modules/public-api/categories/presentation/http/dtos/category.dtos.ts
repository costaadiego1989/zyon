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
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Electronics' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'All electronic devices and gadgets' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'cat_parent_123' })
  @IsOptional()
  @IsString()
  parent_id?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/cat.jpg' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  image_url?: string;

  @ApiPropertyOptional({ example: 'electronics' })
  @IsOptional()
  @IsString()
  slug?: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Updated Electronics' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'cat_parent_456' })
  @IsOptional()
  @IsString()
  parent_id?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/cat2.jpg' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  image_url?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sort_order?: number;
}

export class CategoryOrderItemDto {
  @ApiProperty({ example: 'cat_abc123' })
  @IsString()
  @IsNotEmpty()
  category_id!: string;

  @ApiProperty({ example: 0 })
  @IsNumber()
  @Min(0)
  position!: number;
}

export class ReorderCategoryDto {
  @ApiProperty({ type: [CategoryOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryOrderItemDto)
  category_orders!: CategoryOrderItemDto[];
}
