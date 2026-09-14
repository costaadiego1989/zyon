import { billingOffers } from "../../../../payment/infrastructure/billing-offers.js";
import type { BillingPlan } from "../../../../payment/domain/payment-platform.types.js";
import type { BillingSubscriptionWithPlanSnapshot, BillingUsageSnapshot } from '../../../../payment/domain/payment-platform.types.js';
import { BILLING_PLANS, BUYER_SERVICE_FEE_CENTS } from '../../../../payment/domain/billing-plans.js';
import type { PlanResponse, SubscriptionResponse, UsageResponse, InvoiceResponse } from '../../presentation/http/dtos/billing.dtos.js';
import type { OrderQuotaSnapshot } from '../../../../payment/domain/services/order-quota.types.js';

export class BillingEntityMapper {
  static toPlansResponse(): PlanResponse[] {
    return (Object.entries(BILLING_PLANS) as Array<[string, typeof BILLING_PLANS[keyof typeof BILLING_PLANS]]>).map(
      ([planId, config]) => ({
        plan_id: planId,
        billing_options: billingOffers(planId as BillingPlan),
        annual_checkout_available: planId !== "starter" && billingOffers(planId as BillingPlan).some(o => o.cycle === "annual") &&
          Boolean(process.env["STRIPE_BILLING_PRICE_" + planId.toUpperCase() + "_ANNUAL"]?.trim()),
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
      billing_cycle: snapshot.billingCycle ?? "monthly",
      billing_amount_cents: snapshot.billingAmountCents,
      billing_discount_percent: snapshot.billingDiscountPercent,
      pending_plan: snapshot.pendingPlanKey,
      pending_billing_cycle: snapshot.pendingBillingCycle,
      pending_billing_amount_cents: snapshot.pendingBillingAmountCents,
      pending_effective_at: snapshot.pendingPlanEffectiveAt,
      plan: snapshot.plan,
      trial_end: snapshot.trialEndsAt,
      trial_expired: snapshot.trialExpired,
      trial_days_remaining: snapshot.trialDaysRemaining,
      billing_provider: snapshot.provider ?? "stripe",
      has_billing_customer: Boolean(snapshot.stripeCustomerId || snapshot.asaasCustomerId),
      has_subscription: Boolean(snapshot.stripeSubscriptionId || snapshot.asaasSubscriptionId),
      limits: snapshot.limits,
      features: snapshot.features,
      usage: snapshot.usage ? {
        period_start: snapshot.commercial?.periodStart ?? snapshot.usage.periodStart,
        usage_period_end: snapshot.commercial?.periodEnd ?? null,
        orders_current: snapshot.commercial?.usedOrders ?? snapshot.usage.ordersPerMonth,
        orders_limit: snapshot.commercial?.limit ?? snapshot.limits.ordersPerMonth ?? null,
        orders_overage: snapshot.commercial?.limit == null ? 0 : Math.max(0, snapshot.commercial.usedOrders - snapshot.commercial.limit),
        commercial_status: snapshot.commercial?.state ?? "active",
        grace_expires_at: snapshot.commercial?.graceExpiresAt ?? null,
        required_plan: snapshot.commercial?.requiredPlan ?? null,
        can_accept_orders: snapshot.commercial?.canAcceptOrders ?? true,
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

  static toUsageResponse(
    usage: BillingUsageSnapshot,
    limits: Record<string, number | null>,
    commercial?: OrderQuotaSnapshot,
  ): UsageResponse {
    return {
      period_start: commercial?.periodStart ?? usage.periodStart,
      orders_per_month: commercial?.usedOrders ?? usage.ordersPerMonth,
      commerce_connections: usage.commerceConnections,
      webhook_endpoints: usage.webhookEndpoints,
      team_members: usage.teamMembers,
      cross_sell_promotions: usage.crossSellPromotions,
      active_coupons: usage.activeCoupons,
      limits,
      commercial_status: commercial?.state,
      grace_expires_at: commercial?.graceExpiresAt,
      usage_period_end: commercial?.periodEnd,
      orders_overage: commercial?.limit == null ? 0 : Math.max(0, commercial.usedOrders - commercial.limit),
      required_plan: commercial?.requiredPlan,
      can_accept_orders: commercial?.canAcceptOrders,
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
