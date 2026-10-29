import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerSummaryResponse {
  @ApiProperty({ example: 'cust_123', description: 'Customer ID' })
  id!: string;

  @ApiProperty({
    example: {
      email: 'customer@example.com',
      name: 'John Doe',
      phone: '+5511999999999',
    },
    description: 'Customer profile information',
  })
  profile!: Record<string, unknown>;

  @ApiProperty({
    example: '2024-01-15T10:30:00Z',
    description: 'ISO timestamp of first order',
  })
  first_seen_at!: string;

  @ApiProperty({
    example: '2024-08-10T14:22:00Z',
    description: 'ISO timestamp of most recent order',
  })
  last_seen_at!: string;
}

export class CustomerOrderResponse {
  @ApiProperty({ example: 'ord_456', description: 'Order ID' })
  order_id!: string;

  @ApiProperty({ example: 'USD', description: 'Currency code' })
  currency!: string;

  @ApiProperty({
    example: 12999,
    description: 'Order total in minor units (cents)',
  })
  total_minor!: number;

  @ApiProperty({
    example: 2000,
    description: 'Discount applied in minor units',
  })
  discount_minor!: number;

  @ApiProperty({
    example: [{ sku: 'SKU123', title: 'Product A', quantity: 2 }],
    description: 'Line items',
  })
  items!: unknown;

  @ApiProperty({
    example: '2024-08-10T14:22:00Z',
    description: 'ISO timestamp when order completed',
  })
  completed_at!: string;
}

export class CustomerDetailResponse extends CustomerSummaryResponse {
  @ApiProperty({
    description: 'Customer purchase history',
    type: [CustomerOrderResponse],
  })
  purchase_history!: CustomerOrderResponse[];
}
