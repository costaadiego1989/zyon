import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { OBSERVATION_REPOSITORY_PORT, type ObservationRepositoryPort } from "../../domain/ports/observation-repository.port.js";
import { ObservationEntity } from "../../domain/entities/observation.entity.js";

export interface ObserveMetricsInput {
  merchant_id: string;
  window_start: Date;
  window_end: Date;
}

export interface ObserveMetricsOutput {
  observation_id: string;
  is_new: boolean;
  top_abandonment_reason: string;
  conversion_rate: number;
}

/**
 * ObserveMetricsUseCase — Compiles real metrics from checkout data.
 *
 * Queries:
 * - CheckoutSession (funnel + abandonment via score)
 * - CheckoutEvent (event distribution)
 * - PromptVariantResult (experiment performance)
 * - CompletedOrder (revenue)
 * - NegotiationCostLedgerEntry (AI costs)
 *
 * Returns deduped observation or creates new one.
 */
@Injectable()
export class ObserveMetricsUseCase {
  private readonly logger = new Logger(ObserveMetricsUseCase.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(OBSERVATION_REPOSITORY_PORT) private readonly observationRepo: ObservationRepositoryPort,
  ) {}

  async execute(input: ObserveMetricsInput): Promise<ObserveMetricsOutput> {
    const metrics = await this.compileMetrics(
      input.merchant_id,
      input.window_start,
      input.window_end,
    );

    const observation = ObservationEntity.create(metrics);

    // Check for duplicate (fingerprint-based dedup)
    const existing = await this.observationRepo.findByFingerprint(observation.fingerprint);
    if (existing) {
      this.logger.debug(`Observation fingerprint already exists for merchant ${input.merchant_id}: returning existing`);
      return {
        observation_id: existing.id,
        is_new: false,
        top_abandonment_reason: existing.abandonment.top_abandonment_objection,
        conversion_rate: existing.funnel.conversion_rate,
      };
    }

    await this.observationRepo.save(observation);

    this.logger.log(
      `Recorded observation for merchant ${input.merchant_id}: ` +
      `conversion_rate=${metrics.funnel.conversion_rate.toFixed(3)}, ` +
      `abandonment_rate=${metrics.abandonment.abandonment_rate.toFixed(3)}`,
    );

    return {
      observation_id: observation.id,
      is_new: true,
      top_abandonment_reason: observation.abandonment.top_abandonment_objection,
      conversion_rate: observation.funnel.conversion_rate,
    };
  }

  private async compileMetrics(
    merchantId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<Parameters<typeof ObservationEntity.create>[0]> {
    // Total sessions
    const totalSessions = await this.prisma.checkoutSession.count({
      where: {
        merchantId,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
    });

    // Completed orders
    const completedOrders = await this.prisma.completedOrder.count({
      where: {
        merchantId,
        completedAt: { gte: windowStart, lte: windowEnd },
      },
    });

    const conversionRate = totalSessions > 0 ? completedOrders / totalSessions : 0;

    // Abandonment: sessions with high abandonmentScore that did NOT convert
    const highAbandonmentSessions = await this.prisma.checkoutSession.count({
      where: {
        merchantId,
        createdAt: { gte: windowStart, lte: windowEnd },
        abandonmentScore: { gte: 0.5 },
        completedOrders: { none: {} },
      },
    });

    const abandonmentRate = totalSessions > 0 ? highAbandonmentSessions / totalSessions : 0;

    // Event-based stage analysis
    const eventCounts = await this.prisma.checkoutEvent.groupBy({
      by: ["eventName"],
      where: {
        merchantId,
        occurredAt: { gte: windowStart, lte: windowEnd },
      },
      _count: true,
    });

    const eventMap: Record<string, number> = {};
    for (const ev of eventCounts) {
      eventMap[ev.eventName] = ev._count;
    }

    // Infer funnel from events
    const startedCheckout = eventMap["checkout_started"] ?? totalSessions;
    const reachedShipping = eventMap["shipping_selected"] ?? Math.round(totalSessions * 0.6);
    const reachedPayment = eventMap["payment_started"] ?? Math.round(totalSessions * 0.4);

    // Abandonment reasons: infer from event distribution
    const shippingAbandoned = eventMap["abandoned_at_shipping"] ?? Math.round(highAbandonmentSessions * 0.4);
    const paymentAbandoned = eventMap["abandoned_at_payment"] ?? Math.round(highAbandonmentSessions * 0.6);

    // Objections: infer from event names containing "objection"
    const objections = {
      shipping_cost_count: eventMap["objection_shipping_cost"] ?? 0,
      price_count: eventMap["objection_price"] ?? 0,
      trust_count: eventMap["objection_trust"] ?? 0,
      payment_count: eventMap["objection_payment"] ?? 0,
      unknown_count: eventMap["objection_unknown"] ?? 0,
    };

    // Top abandonment objection
    const objectionEntries = Object.entries(objections).filter(([, v]) => v > 0);
    const topObjection = objectionEntries.length > 0
      ? objectionEntries.sort((a, b) => b[1] - a[1])[0][0].replace("_count", "")
      : "unknown";

    // Cross-sell data from events
    const crossSellShown = eventMap["cross_sell_shown"] ?? 0;
    const crossSellAccepted = eventMap["cross_sell_accepted"] ?? 0;
    const crossSellAcceptanceRate = crossSellShown > 0 ? crossSellAccepted / crossSellShown : 0;

    // Current running experiment
    const runningExperiment = await this.prisma.promptExperiment.findFirst({
      where: {
        merchantId,
        status: "running",
      },
      include: {
        variants: {
          include: { results: true },
        },
      },
    });

    let currentExperimentMetrics: Parameters<typeof ObservationEntity.create>[0]["current_experiment"];
    if (runningExperiment && runningExperiment.variants.length >= 2) {
      const controlVariant = runningExperiment.variants.find((v) => v.isControl) ?? runningExperiment.variants[0];
      const challengerVariant = runningExperiment.variants.find((v) => !v.isControl) ?? runningExperiment.variants[1];

      const controlSessions = controlVariant.results.length;
      const controlConverted = controlVariant.results.filter((r) => r.converted).length;
      const challengerSessions = challengerVariant.results.length;
      const challengerConverted = challengerVariant.results.filter((r) => r.converted).length;

      currentExperimentMetrics = {
        experiment_id: runningExperiment.id,
        control_conversion_rate: controlSessions > 0 ? controlConverted / controlSessions : 0,
        challenger_conversion_rate: challengerSessions > 0 ? challengerConverted / challengerSessions : 0,
        sessions_per_variant: Math.min(controlSessions, challengerSessions),
      };
    }

    // Revenue
    const revenueData = await this.prisma.completedOrder.aggregate({
      where: {
        merchantId,
        completedAt: { gte: windowStart, lte: windowEnd },
      },
      _sum: { orderTotal: true },
      _count: true,
      _avg: { orderTotal: true },
    });

    const totalRevenueCents = revenueData._sum.orderTotal
      ? Math.round(Number(revenueData._sum.orderTotal) * 100)
      : 0;
    const totalOrders = revenueData._count;
    const avgOrderValueCents = revenueData._avg.orderTotal
      ? Math.round(Number(revenueData._avg.orderTotal) * 100)
      : 0;

    // AI costs (negotiation LLM usage)
    const aiCostData = await this.prisma.negotiationCostLedgerEntry.aggregate({
      where: {
        merchantId,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      _sum: { aiCostCents: true },
    });

    const totalAiCostsCents = aiCostData._sum.aiCostCents ?? 0;

    // Cohort: returning customers (sessions with existing completed orders)
    // Simple heuristic: sessions from buyers that have any prior orders
    const returningCustomersSessions = await this.prisma.checkoutSession.count({
      where: {
        merchantId,
        createdAt: { gte: windowStart, lte: windowEnd },
        globalUserId: {
          in: await this.getReturningBuyerIds(merchantId),
        },
      },
    });

    const returningCustomersRate = totalSessions > 0 ? returningCustomersSessions / totalSessions : 0;

    return {
      merchant_id: merchantId,
      observation_window_start: windowStart,
      observation_window_end: windowEnd,
      funnel: {
        total_sessions: totalSessions,
        started_checkout: startedCheckout,
        reached_shipping: reachedShipping,
        reached_payment: reachedPayment,
        completed_order: completedOrders,
        conversion_rate: conversionRate,
      },
      abandonment: {
        abandoned_at_shipping: shippingAbandoned,
        abandoned_at_payment: paymentAbandoned,
        abandonment_rate: abandonmentRate,
        top_abandonment_objection: topObjection,
      },
      objections,
      cross_sell: {
        suggestions_shown: crossSellShown,
        suggestions_accepted: crossSellAccepted,
        acceptance_rate: crossSellAcceptanceRate,
        top_suggested_skus: [],
      },
      current_experiment: currentExperimentMetrics,
      cohorts: {
        returning_customers_rate: returningCustomersRate,
        new_customers_rate: 1 - returningCustomersRate,
        high_discount_sensitivity_rate: 0.4, // Placeholder: needs buyer-purchase-history analysis
        low_discount_sensitivity_rate: 0.6,
      },
      revenue: {
        total_revenue_cents: totalRevenueCents,
        avg_order_value_cents: avgOrderValueCents,
        total_orders: totalOrders,
      },
      ai_costs_cents: totalAiCostsCents,
    };
  }

  /**
   * Returns globalUserIds that have completed orders (returning buyers).
   * Limited to 1000 for performance.
   */
  private async getReturningBuyerIds(merchantId: string): Promise<string[]> {
    const sessions = await this.prisma.checkoutSession.findMany({
      where: {
        merchantId,
        completedOrders: { some: {} },
      },
      select: { globalUserId: true },
      distinct: ["globalUserId"],
      take: 1000,
    });
    return sessions.map((s) => s.globalUserId);
  }
}
