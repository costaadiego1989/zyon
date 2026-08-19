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

export class ReturnItemResponseDto {
  @ApiProperty({ example: 'ret-item-123', description: 'Return item ID' })
  id!: string;

  @ApiProperty({ example: 'var-123', description: 'Variant ID' })
  variant_id!: string;

  @ApiProperty({ example: 2, description: 'Quantity' })
  quantity!: number;

  @ApiPropertyOptional({ example: 'DEFECTIVE', description: 'Reason' })
  reason?: string | null;
}

export class ShippingLabelDto {
  @ApiProperty({ example: 'lbl-123', description: 'Label ID' })
  id!: string;

  @ApiProperty({ example: 'sedex', description: 'Carrier' })
  carrier!: string;

  @ApiProperty({ example: 'SR123456789BR', description: 'Tracking number' })
  tracking_number!: string;

  @ApiPropertyOptional({ example: 'https://...' })
  label_url?: string | null;

  @ApiProperty({ example: '2024-09-18T12:00:00.000Z', description: 'Label expiration date' })
  expires_at!: string;

  @ApiProperty({ example: '2024-08-18T10:00:00.000Z', description: 'Label creation date' })
  created_at!: string;
}

export class InspectionResultDto {
  @ApiProperty({ example: 'insp-456', description: 'Inspection ID' })
  id!: string;

  @ApiProperty({ example: 'inspector@company.com', description: 'Inspector email' })
  inspected_by!: string;

  @ApiProperty({ example: 'GOOD', enum: ['GOOD', 'ACCEPTABLE', 'DEFECTIVE'], description: 'Item condition' })
  item_condition!: string;

  @ApiProperty({ example: 'APPROVED', enum: ['APPROVED', 'REJECTED', 'NEEDS_REVIEW'], description: 'Inspection verdict' })
  verdict!: string;

  @ApiPropertyOptional({ example: 'Item has minor scratch', description: 'Inspection notes' })
  notes?: string | null;

  @ApiProperty({ example: '2024-08-18T11:00:00.000Z', description: 'Inspection timestamp' })
  inspected_at!: string;
}

export class RefundDto {
  @ApiProperty({ example: 'ref-789', description: 'Refund ID' })
  id!: string;

  @ApiProperty({ example: 9999, description: 'Refund amount in cents' })
  amount_in_cents!: number;

  @ApiProperty({ example: 'completed', enum: ['pending', 'processing', 'completed', 'failed'], description: 'Refund status' })
  status!: string;

  @ApiPropertyOptional({ example: 'pi_abc123', description: 'Payment intent ID' })
  payment_intent_id?: string | null;

  @ApiPropertyOptional({ example: '2024-08-18T12:00:00.000Z', description: 'Processing timestamp' })
  processed_at?: string | null;

  @ApiProperty({ example: '2024-08-18T10:00:00.000Z', description: 'Creation timestamp' })
  created_at!: string;
}

export class ReturnRequestResponse {
  @ApiProperty({ example: 'ret-123', description: 'Return request ID' })
  id!: string;

  @ApiProperty({ example: 'merchant-456', description: 'Merchant ID' })
  merchant_id!: string;

  @ApiProperty({ example: 'ord-789', description: 'Order ID' })
  order_id!: string;

  @ApiProperty({ example: 'buyer-123', description: 'Buyer ID' })
  buyer_id!: string;

  @ApiProperty({ example: 'DEFECTIVE', description: 'Return reason' })
  reason!: string;

  @ApiPropertyOptional({ example: 'Item arrived with dent', description: 'Notes' })
  notes?: string | null;

  @ApiProperty({ example: 'requested', enum: ['requested', 'approved', 'shipped', 'delivered', 'inspected', 'refunded', 'rejected'], description: 'Return status' })
  status!: string;

  @ApiProperty({ type: [ReturnItemResponseDto], description: 'Return items' })
  items!: ReturnItemResponseDto[];

  @ApiPropertyOptional({ type: ShippingLabelDto, description: 'Shipping label' })
  label?: ShippingLabelDto | null;

  @ApiPropertyOptional({ type: InspectionResultDto, description: 'Inspection result' })
  inspection?: InspectionResultDto | null;

  @ApiPropertyOptional({ type: RefundDto, description: 'Refund information' })
  refund?: RefundDto | null;

  @ApiProperty({ example: '2024-08-18T10:00:00.000Z', description: 'Creation timestamp' })
  created_at!: string;

  @ApiProperty({ example: '2024-08-18T11:30:00.000Z', description: 'Last update timestamp' })
  updated_at!: string;
}
