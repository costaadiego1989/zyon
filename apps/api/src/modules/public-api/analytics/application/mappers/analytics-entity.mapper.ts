export class AnalyticsEntityMapper {
  static toDashboardMetricsResponse(result: any) {
    return {
      total_revenue_cents: result.totalRevenue,
      total_orders: result.totalOrders,
      avg_order_value_cents: result.avgOrderValue,
      conversion_rate: result.conversionRate,
      conversations: result.conversations,
      trend: {
        revenue_delta: result.trend.revenueDelta,
        orders_delta: result.trend.ordersDelta,
      },
      daily: (result.daily ?? []).map((d: any) => ({
        date: d.date?.toISOString?.().split('T')[0] ?? d.date,
        revenue_cents: d.revenueInCents,
        orders: d.orders,
        conversations: d.conversations,
      })),
    };
  }

  static toProductPerformanceResponse(result: any) {
    return {
      products: (result.products ?? []).map((p: any) => ({
        product_id: p.productId,
        product_name: p.productName ?? p.name ?? 'Unknown',
        impressions: p.impressions,
        add_to_cart_count: p.addToCartCount ?? p.addToCart,
        purchase_count: p.purchaseCount ?? p.purchases,
        conversion_rate: p.conversionRate,
        revenue_cents: p.revenue,
      })),
      total_products: result.products?.length ?? result.totalProducts ?? 0,
      period_from: result.period?.from?.toISOString?.().split('T')[0] ?? '',
      period_to: result.period?.to?.toISOString?.().split('T')[0] ?? '',
    };
  }

  static toOfferRoiResponse(result: any) {
    return {
      total_offers_shown: result.totalOffersShown,
      total_offers_accepted: result.totalOffersAccepted,
      acceptance_rate: result.acceptanceRate,
      avg_discount_given: result.avgDiscountGiven,
      revenue_from_offers_cents: result.revenueFromOffers,
      revenue_without_offers_cents: result.revenueWithoutOffers,
      lift_percent: result.liftPercent,
      period_from: result.period?.from?.toISOString?.().split('T')[0] ?? '',
      period_to: result.period?.to?.toISOString?.().split('T')[0] ?? '',
    };
  }

  static toPaymentMetricsResponse(result: any) {
    return {
      total_attempts: result.totalAttempts,
      successful: result.successful,
      failed: result.failed,
      failure_rate: result.failureRate,
      by_provider: (result.byProvider ?? []).map((p: any) => ({
        provider: p.provider,
        attempts: p.attempts,
        successful: p.successful,
        failed: p.failed,
        failure_rate: p.failureRate,
      })),
      period_from: result.period?.from?.toISOString?.().split('T')[0] ?? '',
      period_to: result.period?.to?.toISOString?.().split('T')[0] ?? '',
    };
  }

  static toCustomerMetricsResponse(result: any) {
    return {
      total_customers: result.totalCustomers,
      new_customers: result.newCustomers,
      returning_customers: result.returningCustomers,
      repeat_rate: result.repeatRate,
      period_from: result.period?.from?.toISOString?.().split('T')[0] ?? '',
      period_to: result.period?.to?.toISOString?.().split('T')[0] ?? '',
    };
  }
}
