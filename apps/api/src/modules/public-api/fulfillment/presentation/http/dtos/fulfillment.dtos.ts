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

export class ShipmentSummaryResponse {
  @ApiProperty({ example: 'shp_abc123' })
  id!: string;

  @ApiProperty({ example: 'order_xyz789' })
  order_id!: string;

  @ApiProperty({ example: 'correios' })
  carrier!: string;

  @ApiPropertyOptional({ example: 'BR123456789' })
  tracking_code?: string;

  @ApiProperty({ example: 'in_transit', enum: ['pending', 'in_transit', 'delivered', 'returned'] })
  status!: string;

  @ApiPropertyOptional({ example: 'https://carrier.example.com/label/abc' })
  label_url?: string;

  @ApiProperty({ example: '2024-08-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-08-16T14:00:00Z' })
  updated_at!: string;
}

export class CreateShipmentResponse {
  @ApiProperty({ example: 'shp_abc123' })
  shipment_id!: string;

  @ApiProperty({ example: 'order_xyz789' })
  order_id!: string;

  @ApiProperty({ example: 'correios' })
  carrier!: string;

  @ApiProperty({ example: 'pending' })
  status!: string;

  @ApiProperty({ example: '2024-08-15T10:30:00Z' })
  created_at!: string;
}
