import { Injectable } from "@nestjs/common";
import { RevenueLiftRepository, type FeatureBreakout, type DailyTrendPoint } from "../../infrastructure/revenue-lift.repository.js";
import { RevenueLiftCalculatorService, type LiftCalculationResult } from "../../domain/services/revenue-lift-calculator.service.js";

const MINIMUM_COHORT_SESSIONS = 30;

export interface RevenueLiftDataQuality {
  status: "ready" | "insufficient_data";
  minimumCohortSessions: number;
  sources: Record<"checkoutSessions" | "completedOrders" | "attributionTags", "measured" | "partial">;
  missingMetrics: string[];
}

export interface RevenueLiftSummary {
  periodDays: number;
  holdout: { sessions: number; orders: number; revenueCents: number; avgRevenueCents: number | null };
  treatment: { sessions: number; orders: number; revenueCents: number; avgRevenueCents: number | null };
  lift: LiftCalculationResult;
  dataQuality: RevenueLiftDataQuality;
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

    const missingMetrics = [
      ...(cohorts.holdout.sessions < MINIMUM_COHORT_SESSIONS ? ["holdout_session_sample"] : []),
      ...(cohorts.treatment.sessions < MINIMUM_COHORT_SESSIONS ? ["treatment_session_sample"] : []),
      ...(cohorts.holdout.totalRevenueCents <= 0 ? ["holdout_revenue_baseline"] : []),
    ];
    const dataQuality: RevenueLiftDataQuality = {
      status: missingMetrics.length === 0 ? "ready" : "insufficient_data",
      minimumCohortSessions: MINIMUM_COHORT_SESSIONS,
      sources: {
        checkoutSessions: "measured",
        completedOrders: "measured",
        attributionTags: "partial",
      },
      missingMetrics,
    };
    const calculatedLift = this.calculator.calculate({
      holdout: { sessions: cohorts.holdout.sessions, orders: cohorts.holdout.orders, totalRevenueCents: cohorts.holdout.totalRevenueCents },
      treatment: { sessions: cohorts.treatment.sessions, orders: cohorts.treatment.orders, totalRevenueCents: cohorts.treatment.totalRevenueCents },
      aiCostsTotalCents: totalAiCost,
    });
    const lift = dataQuality.status === "ready" ? calculatedLift : unavailableLift();

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
      dataQuality,
      aiCostCents: totalAiCost,
      featureBreakout,
    };
  }
}

function unavailableLift(): LiftCalculationResult {
  return {
    holdoutAvgRevenueCents: null,
    treatmentAvgRevenueCents: null,
    grossLiftPercent: null,
    holdoutProjectedCents: null,
    netLiftCents: null,
    roiPercent: null,
  };
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
      if (d.holdoutSessions >= MINIMUM_COHORT_SESSIONS && d.treatmentSessions >= MINIMUM_COHORT_SESSIONS) {
        const holdoutAvg = d.holdoutRevenueCents / d.holdoutSessions;
        const treatmentAvg = d.treatmentSessions > 0 ? d.treatmentRevenueCents / d.treatmentSessions : 0;
        liftPercent = holdoutAvg > 0 ? ((treatmentAvg - holdoutAvg) / holdoutAvg) * 100 : null;
      }
      return { ...d, liftPercent };
    });

    return { periodDays: days, trend };
  }
}
