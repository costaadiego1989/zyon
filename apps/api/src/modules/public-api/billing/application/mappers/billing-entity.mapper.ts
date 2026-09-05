import type { BillingSubscriptionWithPlanSnapshot, BillingUsageSnapshot } from '../../../../payment/domain/payment-platform.types.js';
import { BILLING_PLANS, BUYER_SERVICE_FEE_CENTS } from '../../../../payment/domain/billing-plans.js';
import type { PlanResponse, SubscriptionResponse, UsageResponse, InvoiceResponse } from '../../presentation/http/dtos/billing.dtos.js';

export class BillingEntityMapper {
  static toPlansResponse(): PlanResponse[] {
    return (Object.entries(BILLING_PLANS) as Array<[string, typeof BILLING_PLANS[keyof typeof BILLING_PLANS]]>).map(
      ([planId, config]) => ({
        plan_id: planId,
        name: config.name,
        monthly_price_brl: config.monthlyPriceBrl,
        transaction_fee_cents: config.transactionFeeCents,
        buyer_service_fee_cents: BUYER_SERVICE_FEE_CENTS,
        limits: config.limits as Record<string, number | null>,
        features: config.features as Record<string, boolean>,
      }),
    );
  }

  static toSubscriptionResponse(snapshot: BillingSubscriptionWithPlanSnapshot): SubscriptionResponse {
    return {
      merchant_id: snapshot.merchantId,
      plan_id: snapshot.plan,
      plan: snapshot.plan,
      trial_end: snapshot.trialEndsAt,
      trial_expired: snapshot.trialExpired,
      trial_days_remaining: snapshot.trialDaysRemaining,
      billing_provider: snapshot.provider ?? "stripe",
      has_billing_customer: Boolean(snapshot.stripeCustomerId),
      has_subscription: Boolean(snapshot.stripeSubscriptionId),
      limits: snapshot.limits,
      features: snapshot.features,
      usage: snapshot.usage ? {
        period_start: snapshot.usage.periodStart,
        orders_current: snapshot.usage.ordersPerMonth,
        orders_limit: snapshot.limits.ordersPerMonth ?? null,
        sessions_current: snapshot.usage.sessionsPerMonth,
        sessions_limit: snapshot.limits.sessionsPerMonth ?? null,
        ai_conversations_current: snapshot.usage.aiConversationsPerMonth,
        ai_conversations_limit: snapshot.limits.aiConversationsPerMonth ?? null,
        commerce_connections_current: snapshot.usage.commerceConnections,
        commerce_connections_limit: snapshot.limits.commerceConnections ?? null,
      } : undefined,
      plan_name: snapshot.planName,
      status: snapshot.status,
      trial_ends_at: snapshot.trialEndsAt,
      current_period_end: snapshot.currentPeriodEnd,
      cancel_at_period_end: snapshot.cancelAtPeriodEnd,
      monthly_price_brl: snapshot.monthlyPriceBrl,
      transaction_fee_cents: snapshot.transactionFeeCents,
      buyer_service_fee_cents: snapshot.buyerServiceFeeCents,
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
