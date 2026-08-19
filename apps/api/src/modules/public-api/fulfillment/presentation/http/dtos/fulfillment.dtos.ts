import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ShipmentItemDto {
  @ApiProperty({ example: 'variant_abc123', description: 'Variant ID of the item being shipped' })
  @IsString()
  @IsNotEmpty()
  variant_id!: string;

  @ApiProperty({ example: 2, description: 'Quantity being shipped' })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateShipmentDto {
  @ApiProperty({ example: 'order_xyz789', description: 'Order ID to create shipment for' })
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @ApiProperty({ example: 'correios', description: 'Carrier key identifier' })
  @IsString()
  @IsNotEmpty()
  carrier!: string;

  @ApiPropertyOptional({ example: 'BR123456789', description: 'Tracking code from carrier' })
  @IsOptional()
  @IsString()
  tracking_code?: string;

  @ApiPropertyOptional({
    type: [ShipmentItemDto],
    description: 'Items included in this shipment',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentItemDto)
  items?: ShipmentItemDto[];
}
