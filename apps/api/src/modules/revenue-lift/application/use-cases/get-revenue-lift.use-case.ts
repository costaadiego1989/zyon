import { Injectable } from "@nestjs/common";
import { RevenueLiftRepository, type FeatureBreakout, type DailyTrendPoint } from "../../infrastructure/revenue-lift.repository.js";
import { RevenueLiftCalculatorService, type LiftCalculationResult } from "../../domain/services/revenue-lift-calculator.service.js";

export interface RevenueLiftSummary {
  periodDays: number;
  holdout: { sessions: number; orders: number; revenueCents: number; avgRevenueCents: number | null };
  treatment: { sessions: number; orders: number; revenueCents: number; avgRevenueCents: number | null };
  lift: LiftCalculationResult;
  aiCostCents: number;
  featureBreakout: FeatureBreakout[];
}

export interface RevenueLiftTrend {
  periodDays: number;
  trend: Array<DailyTrendPoint & { liftPercent: number | null }>;
}

@Injectable()
export class GetRevenueLiftUseCase {
  constructor(
    private readonly repo: RevenueLiftRepository,
    private readonly calculator: RevenueLiftCalculatorService,
  ) {}

  async execute(merchantId: string, periodDays: number = 30): Promise<RevenueLiftSummary> {
    const to = new Date();
    const from = new Date(to.getTime() - periodDays * 86_400_000);

    const [cohorts, featureBreakout] = await Promise.all([
      this.repo.aggregateByCohort(merchantId, from, to),
      this.repo.getFeatureBreakout(merchantId, from, to),
    ]);

    const totalAiCost = cohorts.treatment.totalAiCostCents;

    const lift = this.calculator.calculate({
      holdout: { sessions: cohorts.holdout.sessions, orders: cohorts.holdout.orders, totalRevenueCents: cohorts.holdout.totalRevenueCents },
      treatment: { sessions: cohorts.treatment.sessions, orders: cohorts.treatment.orders, totalRevenueCents: cohorts.treatment.totalRevenueCents },
      aiCostsTotalCents: totalAiCost,
    });

    return {
      periodDays,
      holdout: {
        sessions: cohorts.holdout.sessions,
        orders: cohorts.holdout.orders,
        revenueCents: cohorts.holdout.totalRevenueCents,
        avgRevenueCents: lift.holdoutAvgRevenueCents,
      },
      treatment: {
        sessions: cohorts.treatment.sessions,
        orders: cohorts.treatment.orders,
        revenueCents: cohorts.treatment.totalRevenueCents,
        avgRevenueCents: lift.treatmentAvgRevenueCents,
      },
      lift,
      aiCostCents: totalAiCost,
      featureBreakout,
    };
  }
}

@Injectable()
export class GetRevenueLiftTrendUseCase {
  constructor(
    private readonly repo: RevenueLiftRepository,
    private readonly calculator: RevenueLiftCalculatorService,
  ) {}

  async execute(merchantId: string, days: number = 30): Promise<RevenueLiftTrend> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const daily = await this.repo.getDailyTrend(merchantId, from, to);

    const trend = daily.map((d: DailyTrendPoint) => {
      let liftPercent: number | null = null;
      if (d.holdoutSessions > 0) {
        const holdoutAvg = d.holdoutRevenueCents / d.holdoutSessions;
        const treatmentAvg = d.treatmentSessions > 0 ? d.treatmentRevenueCents / d.treatmentSessions : 0;
        liftPercent = holdoutAvg > 0 ? ((treatmentAvg - holdoutAvg) / holdoutAvg) * 100 : null;
      }
      return { ...d, liftPercent };
    });

    return { periodDays: days, trend };
  }
}
