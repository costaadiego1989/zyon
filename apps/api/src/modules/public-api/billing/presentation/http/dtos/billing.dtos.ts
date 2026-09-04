import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

export class ChangePlanDto {
  @ApiProperty({ example: 'pro', description: 'Target plan ID' })
  @IsString()
  @IsNotEmpty()
  plan_id!: string;

  @ApiPropertyOptional({ enum: ['immediate', 'next_cycle'], example: 'immediate' })
  @IsEnum(['immediate', 'next_cycle'])
  @IsOptional()
  effective?: 'immediate' | 'next_cycle';
}

export class PlanResponse {
  @ApiProperty({ example: 'pro' })
  plan_id!: string;

  @ApiProperty({ example: 'Pro' })
  name!: string;

  @ApiProperty({ example: 199.9 })
  monthly_price_brl!: number;

  @ApiProperty({ example: 149, description: 'Fee do merchant por transação em centavos (sai do repasse)' })
  transaction_fee_cents!: number;

  @ApiProperty({ example: 99, description: 'Taxa de serviço do buyer em centavos (somada ao total do pedido)' })
  buyer_service_fee_cents!: number;

  @ApiProperty({ example: { orders_per_month: 5000, sessions_per_month: 50000 } })
  limits!: Record<string, number | null>;

  @ApiProperty({ example: { cross_sell: true, ab_testing: true } })
  features!: Record<string, boolean>;
}

export class SubscriptionResponse {
  @ApiProperty({ example: 'mch_abc123' })
  merchant_id!: string;

  @ApiProperty({ example: 'pro' })
  plan_id!: string;

  @ApiProperty({ example: 'Pro' })
  plan_name!: string;

  @ApiProperty({ example: 'active', enum: ['active', 'trialing', 'past_due', 'canceled'] })
  status!: string;

  @ApiPropertyOptional({ example: '2024-09-15T00:00:00Z' })
  trial_ends_at?: string;

  @ApiPropertyOptional({ example: '2024-10-01T00:00:00Z' })
  current_period_end?: string;

  @ApiProperty({ example: false })
  cancel_at_period_end!: boolean;

  @ApiProperty({ example: 199.9 })
  monthly_price_brl!: number;

  @ApiProperty({ example: 149, description: 'Fee do merchant por transação em centavos' })
  transaction_fee_cents!: number;

  @ApiProperty({ example: 99, description: 'Taxa de serviço do buyer em centavos' })
  buyer_service_fee_cents!: number;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-08-01T14:00:00Z' })
  updated_at!: string;
}

export class UsageResponse {
  @ApiProperty({ example: '2024-08-01T00:00:00Z' })
  period_start!: string;

  @ApiProperty({ example: 1234 })
  orders_per_month!: number;

  @ApiProperty({ example: 15000 })
  sessions_per_month!: number;

  @ApiProperty({ example: 800 })
  ai_conversations_per_month!: number;

  @ApiProperty({ example: 2 })
  commerce_connections!: number;

  @ApiProperty({ example: 3 })
  webhook_endpoints!: number;

  @ApiProperty({ example: 5 })
  team_members!: number;

  @ApiProperty({ example: 4 })
  cross_sell_promotions!: number;

  @ApiProperty({ example: 10 })
  active_coupons!: number;

  @ApiProperty({ example: { orders_per_month: 5000, sessions_per_month: 50000 } })
  limits!: Record<string, number | null>;
}

export class InvoiceResponse {
  @ApiProperty({ example: 'inv_abc123' })
  invoice_id!: string;

  @ApiProperty({ example: 199.9 })
  amount_brl!: number;

  @ApiProperty({ example: '2024-07-01T00:00:00Z' })
  period_start!: string;

  @ApiProperty({ example: '2024-07-31T23:59:59Z' })
  period_end!: string;

  @ApiProperty({ example: 'paid', enum: ['paid', 'pending', 'overdue', 'void'] })
  status!: string;

  @ApiProperty({ example: '2024-08-01T10:00:00Z' })
  created_at!: string;

  @ApiPropertyOptional({ example: 'https://billing.example.com/inv/abc123' })
  invoice_url?: string;
}

export class CreditCardDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  holderName!: string;

  @ApiProperty({ example: '4111111111111111' })
  @IsString()
  @IsNotEmpty()
  number!: string;

  @ApiProperty({ example: '12' })
  @IsString()
  @IsNotEmpty()
  expiryMonth!: string;

  @ApiProperty({ example: '2026' })
  @IsString()
  @IsNotEmpty()
  expiryYear!: string;

  @ApiProperty({ example: '123' })
  @IsString()
  @IsNotEmpty()
  ccv!: string;
}

export class BillingHolderInfoDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: '12345678901234' })
  @IsString()
  @IsNotEmpty()
  cpfCnpj!: string;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  postalCode!: string;

  @ApiProperty({ example: '100' })
  @IsString()
  @IsNotEmpty()
  addressNumber!: string;

  @ApiProperty({ example: '+5511999999999' })
  @IsString()
  @IsNotEmpty()
  phone!: string;
}

export class SubscribeToPlanDto {
  @ApiProperty({ example: 'growth', enum: ['growth', 'scale'] })
  @IsEnum(['growth', 'scale'])
  @IsNotEmpty()
  planKey!: 'growth' | 'scale';

  @ApiProperty({ type: CreditCardDto })
  @IsNotEmpty()
  card!: CreditCardDto;

  @ApiProperty({ type: BillingHolderInfoDto })
  @IsNotEmpty()
  holderInfo!: BillingHolderInfoDto;

  @ApiPropertyOptional({ example: '192.168.1.1' })
  @IsString()
  @IsOptional()
  remoteIp?: string;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({ example: false, description: 'Cancel immediately (default) or at period end' })
  @IsOptional()
  immediate?: boolean;
}

export class PlansListResponse {
  @ApiProperty({ example: [{ key: 'starter', name: 'Starter', priceBrl: 0 }] })
  plans!: Array<{
    key: string;
    name: string;
    priceBrl: number;
    trialDays: number;
    badge?: string;
    recommended?: boolean;
    features: string[];
    ctaLabel: string;
  }>;
}
