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

// Response DTOs

export class OrderSummaryResponse {
  @ApiProperty({ example: 'order_abc123' })
  id!: string;

  @ApiPropertyOptional({ example: 'ext_order_123' })
  external_order_id?: string;

  @ApiProperty({ example: 'pending', enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] })
  status!: string;

  @ApiProperty({ example: 14990, description: 'Total in minor units (cents)' })
  total_minor!: number;

  @ApiProperty({ example: 'BRL' })
  currency!: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  customer_email?: string;

  @ApiProperty({ example: 3 })
  items_count!: number;

  @ApiProperty({ example: '2026-08-18T12:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-08-18T13:00:00.000Z' })
  updated_at!: string;
}

export class OrderTrackingResponse {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  tracking?: Record<string, any>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  code?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  carrier?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  url?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  status?: string;
}

export class OrderDetailResponse {
  @ApiProperty({ example: 'order_abc123' })
  id!: string;

  @ApiPropertyOptional({ example: 'ext_order_123' })
  external_order_id?: string;

  @ApiPropertyOptional({ example: 'sess_xyz789' })
  session_id?: string;

  @ApiProperty({ example: 'pending' })
  status!: string;

  @ApiProperty({ example: 14990 })
  total_minor!: number;

  @ApiProperty({ example: 'BRL' })
  currency!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  customer?: Record<string, any>;

  @ApiPropertyOptional({ type: [Object] })
  items?: any[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  shipping?: Record<string, any>;

  @ApiPropertyOptional({ type: OrderTrackingResponse })
  tracking?: OrderTrackingResponse;

  @ApiPropertyOptional({ example: 'offer_abc123' })
  accepted_offer_id?: string;

  @ApiPropertyOptional({ example: 'pi_stripe_123' })
  payment_intent_id?: string;

  @ApiProperty({ example: '2026-08-18T12:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-08-18T13:00:00.000Z' })
  updated_at!: string;
}

export class TrackingDetailsResponse {
  @ApiProperty({ example: 'order_abc123' })
  order_id!: string;

  @ApiPropertyOptional({ example: 'BR123456789' })
  tracking_code?: string;

  @ApiPropertyOptional({ example: 'Correios' })
  carrier?: string;

  @ApiPropertyOptional({ example: 'https://correios.com.br/track?code=BR123456789' })
  tracking_url?: string;

  @ApiProperty({ example: 'in_transit', enum: ['pending', 'in_transit', 'delivered', 'failed'] })
  status!: string;

  @ApiPropertyOptional({ type: [Object] })
  events?: any[];

  @ApiProperty({ example: '2026-08-18T13:00:00.000Z' })
  updated_at!: string;
}

export class CancelOrderResponse {
  @ApiProperty({ example: true })
  cancelled!: boolean;

  @ApiProperty({ example: 'order_abc123' })
  order_id!: string;

  @ApiProperty({ example: 'cancelled' })
  status!: string;
}

export class UpdateTrackingResponse {
  @ApiProperty({ example: true })
  updated!: boolean;

  @ApiProperty({ example: 'order_abc123' })
  order_id!: string;

  @ApiProperty({ example: 'shipped' })
  status!: string;

  @ApiPropertyOptional({ example: 'BR123456789' })
  tracking_code?: string;
}

export class OrderListResponse {
  @ApiProperty({ type: [OrderSummaryResponse] })
  data!: OrderSummaryResponse[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  pagination!: {
    next_cursor: string | null;
    has_more: boolean;
  };
}
