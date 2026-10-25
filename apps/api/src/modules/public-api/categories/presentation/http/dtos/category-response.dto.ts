import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryResponse {
  @ApiProperty({ example: 'cat_abc123', description: 'Unique category identifier' })
  id!: string;

  @ApiProperty({ example: 'Electronics', description: 'Category display name' })
  name!: string;

  @ApiPropertyOptional({ example: 'electronics', description: 'URL-friendly slug' })
  slug!: string | null;

  @ApiPropertyOptional({
    example: 'cat_parent_xyz',
    description: 'Parent category ID if this is a subcategory',
  })
  parent_id!: string | null;

  @ApiPropertyOptional({ example: 'All electronic devices and gadgets' })
  description!: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/category.jpg' })
  image_url!: string | null;

  @ApiProperty({ example: true, description: 'Whether category is active and visible' })
  is_active!: boolean;

  @ApiProperty({ example: 0, description: 'Sort order for display' })
  sort_order!: number;

  @ApiProperty({ example: 42, description: 'Number of products in this category' })
  product_count!: number;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string | null;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string | null;
}
