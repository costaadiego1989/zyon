import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsISO8601,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DailyMetricDto {
  @ApiProperty({ example: '2024-08-18' })
  date!: string;

  @ApiProperty({ example: 10000 })
  revenue_cents!: number;

  @ApiProperty({ example: 5 })
  orders!: number;

  @ApiProperty({ example: 25 })
  conversations!: number;
}

export class TrendDto {
  @ApiProperty({ example: 15.5, description: 'Revenue change percent vs previous period' })
  revenue_delta!: number;

  @ApiProperty({ example: 20.0, description: 'Orders change percent vs previous period' })
  orders_delta!: number;
}

export class DashboardMetricsResponse {
  @ApiProperty({ example: 150000 })
  total_revenue_cents!: number;

  @ApiProperty({ example: 42 })
  total_orders!: number;

  @ApiProperty({ example: 3571 })
  avg_order_value_cents!: number;

  @ApiProperty({ example: 0.15 })
  conversion_rate!: number;

  @ApiProperty({ example: 280 })
  conversations!: number;

  @ApiProperty()
  trend!: TrendDto;

  @ApiProperty({ type: [DailyMetricDto] })
  daily!: DailyMetricDto[];
}

export class ProductPerformanceDto {
  @ApiProperty({ example: 'prod_123' })
  product_id!: string;

  @ApiProperty({ example: 'Premium T-Shirt' })
  product_name!: string;

  @ApiProperty({ example: 150 })
  impressions!: number;

  @ApiProperty({ example: 30 })
  add_to_cart_count!: number;

  @ApiProperty({ example: 12 })
  purchase_count!: number;

  @ApiProperty({ example: 0.08 })
  conversion_rate!: number;

  @ApiProperty({ example: 50000 })
  revenue_cents!: number;
}

export class ProductPerformanceResponse {
  @ApiProperty({ type: [ProductPerformanceDto] })
  products!: ProductPerformanceDto[];

  @ApiProperty({ example: 8 })
  total_products!: number;

  @ApiProperty({ example: '2024-08-01' })
  period_from!: string;

  @ApiProperty({ example: '2024-08-31' })
  period_to!: string;
}

export class OfferRoiDto {
  @ApiProperty({ example: 500 })
  total_offers_shown!: number;

  @ApiProperty({ example: 125 })
  total_offers_accepted!: number;

  @ApiProperty({ example: 0.25 })
  acceptance_rate!: number;

  @ApiProperty({ example: 15.5, description: 'Average discount percent' })
  avg_discount_given!: number;

  @ApiProperty({ example: 50000 })
  revenue_from_offers_cents!: number;

  @ApiProperty({ example: 30000 })
  revenue_without_offers_cents!: number;

  @ApiProperty({ example: 66.7, description: 'Lift percent' })
  lift_percent!: number;

  @ApiProperty({ example: '2024-08-01' })
  period_from!: string;

  @ApiProperty({ example: '2024-08-31' })
  period_to!: string;
}

export class PaymentMetricByProviderDto {
  @ApiProperty({ example: 'asaas' })
  provider!: string;

  @ApiProperty({ example: 120 })
  attempts!: number;

  @ApiProperty({ example: 115 })
  successful!: number;

  @ApiProperty({ example: 5 })
  failed!: number;

  @ApiProperty({ example: 0.042 })
  failure_rate!: number;
}

export class PaymentMetricsResponse {
  @ApiProperty({ example: 500 })
  total_attempts!: number;

  @ApiProperty({ example: 490 })
  successful!: number;

  @ApiProperty({ example: 10 })
  failed!: number;

  @ApiProperty({ example: 0.02 })
  failure_rate!: number;

  @ApiProperty({ type: [PaymentMetricByProviderDto] })
  by_provider!: PaymentMetricByProviderDto[];

  @ApiProperty({ example: '2024-08-01' })
  period_from!: string;

  @ApiProperty({ example: '2024-08-31' })
  period_to!: string;
}

export class CustomerMetricsResponse {
  @ApiProperty({ example: 500 })
  total_customers!: number;

  @ApiProperty({ example: 120 })
  new_customers!: number;

  @ApiProperty({ example: 380 })
  returning_customers!: number;

  @ApiProperty({ example: 0.76 })
  repeat_rate!: number;

  @ApiProperty({ example: '2024-08-01' })
  period_from!: string;

  @ApiProperty({ example: '2024-08-31' })
  period_to!: string;
}

export class QueryDateRangeDto {
  @ApiPropertyOptional({
    example: '2024-08-01',
    description: 'Start date (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @ApiPropertyOptional({
    example: '2024-08-31',
    description: 'End date (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  date_to?: string;
}

export class QueryProductIdDto {
  @ApiPropertyOptional({ example: 'prod_123' })
  @IsOptional()
  @IsString()
  product_id?: string;
}

export class QueryOfferIdDto {
  @ApiPropertyOptional({ example: 'offer_456' })
  @IsOptional()
  @IsString()
  offer_id?: string;
}
