import { IsString, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

export class ChangePlanDto {
  @IsString()
  @IsNotEmpty()
  plan_id: string;

  @IsEnum(['immediate', 'next_cycle'])
  @IsOptional()
  effective?: 'immediate' | 'next_cycle';
}

export class PlanResponse {
  plan_id: string;
  name: string;
  monthly_price_brl: number;
  transaction_fee_percent: number;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
}

export class SubscriptionResponse {
  merchant_id: string;
  plan_id: string;
  plan_name: string;
  status: string;
  trial_ends_at?: string;
  current_period_end?: string;
  cancel_at_period_end: boolean;
  monthly_price_brl: number;
  transaction_fee_percent: number;
  created_at: string;
  updated_at: string;
}

export class UsageResponse {
  period_start: string;
  orders_per_month: number;
  sessions_per_month: number;
  ai_conversations_per_month: number;
  commerce_connections: number;
  webhook_endpoints: number;
  team_members: number;
  cross_sell_promotions: number;
  active_coupons: number;
  limits: Record<string, number | null>;
}

export class InvoiceResponse {
  invoice_id: string;
  amount_brl: number;
  period_start: string;
  period_end: string;
  status: string;
  created_at: string;
  invoice_url?: string;
}
