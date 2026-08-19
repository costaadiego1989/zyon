import type { BillingSubscriptionWithPlanSnapshot, BillingUsageSnapshot } from '../../../../payment/domain/payment-platform.types.js';
import { BILLING_PLANS } from '../../../../payment/domain/billing-plans.js';
import type { PlanResponse, SubscriptionResponse, UsageResponse, InvoiceResponse } from '../../presentation/http/dtos/billing.dtos.js';

export class BillingEntityMapper {
  static toPlansResponse(): PlanResponse[] {
    return (Object.entries(BILLING_PLANS) as Array<[string, typeof BILLING_PLANS[keyof typeof BILLING_PLANS]]>).map(
      ([planId, config]) => ({
        plan_id: planId,
        name: config.name,
        monthly_price_brl: config.monthlyPriceBrl,
        transaction_fee_percent: config.transactionFeePercent,
        limits: config.limits as Record<string, number | null>,
        features: config.features as Record<string, boolean>,
      }),
    );
  }

  static toSubscriptionResponse(snapshot: BillingSubscriptionWithPlanSnapshot): SubscriptionResponse {
    return {
      merchant_id: snapshot.merchantId,
      plan_id: snapshot.plan,
      plan_name: snapshot.planName,
      status: snapshot.status,
      trial_ends_at: snapshot.trialEndsAt,
      current_period_end: snapshot.currentPeriodEnd,
      cancel_at_period_end: snapshot.cancelAtPeriodEnd,
      monthly_price_brl: snapshot.monthlyPriceBrl,
      transaction_fee_percent: snapshot.transactionFeePercent,
      created_at: snapshot.createdAt,
      updated_at: snapshot.updatedAt,
    };
  }

  static toUsageResponse(usage: BillingUsageSnapshot, limits: Record<string, number | null>): UsageResponse {
    return {
      period_start: usage.periodStart,
      orders_per_month: usage.ordersPerMonth,
      sessions_per_month: usage.sessionsPerMonth,
      ai_conversations_per_month: usage.aiConversationsPerMonth,
      commerce_connections: usage.commerceConnections,
      webhook_endpoints: usage.webhookEndpoints,
      team_members: usage.teamMembers,
      cross_sell_promotions: usage.crossSellPromotions,
      active_coupons: usage.activeCoupons,
      limits,
    };
  }

  static toInvoiceResponse(invoice: {
    id: string;
    amountBrl: number;
    periodStart: string;
    periodEnd: string;
    status: string;
    createdAt: string;
    invoiceUrl?: string;
  }): InvoiceResponse {
    return {
      invoice_id: invoice.id,
      amount_brl: invoice.amountBrl,
      period_start: invoice.periodStart,
      period_end: invoice.periodEnd,
      status: invoice.status,
      created_at: invoice.createdAt,
      invoice_url: invoice.invoiceUrl,
    };
  }
}
