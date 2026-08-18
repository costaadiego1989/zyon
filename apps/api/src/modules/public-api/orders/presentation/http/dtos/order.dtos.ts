import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CancelOrderDto {
  @ApiProperty({ example: 'Customer requested cancellation', description: 'Reason for cancellation' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ example: true, description: 'Notify customer via email' })
  @IsOptional()
  @IsBoolean()
  notify_customer?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Restock cancelled items' })
  @IsOptional()
  @IsBoolean()
  restock?: boolean;
}

export class UpdateOrderTrackingDto {
  @ApiProperty({ example: 'shipped', description: 'New order status' })
  @IsString()
  @IsNotEmpty()
  status!: string;

  @ApiPropertyOptional({ example: 'BR123456789', description: 'Tracking code' })
  @IsOptional()
  @IsString()
  tracking_code?: string;

  @ApiPropertyOptional({ example: 'Correios', description: 'Carrier name' })
  @IsOptional()
  @IsString()
  carrier?: string;
}
