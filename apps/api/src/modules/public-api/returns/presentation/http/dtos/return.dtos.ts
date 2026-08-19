import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ValidateNested,
  IsPositive,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReturnItemDto {
  @ApiProperty({ example: 'var-123', description: 'Variant ID to return' })
  @IsString()
  @IsNotEmpty()
  variant_id!: string;

  @ApiProperty({ example: 2, description: 'Quantity to return' })
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ example: 'DEFECTIVE', description: 'Reason for this item' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RequestReturnDto {
  @ApiProperty({ example: 'ord-456', description: 'Order ID' })
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @ApiProperty({
    example: 'DEFECTIVE',
    description: 'Return reason: DEFECTIVE, WRONG_ITEM, NOT_AS_DESCRIBED, CHANGED_MIND, DAMAGED_IN_TRANSIT, OTHER',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiProperty({
    type: [ReturnItemDto],
    description: 'Items to return',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];

  @ApiPropertyOptional({ example: 'Item arrived with dent', description: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}
