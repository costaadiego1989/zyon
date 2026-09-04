import { Injectable } from "@nestjs/common";

export interface CohortMetrics {
  sessions: number;
  orders: number;
  totalRevenueCents: number;
}

export interface LiftCalculationInput {
  holdout: CohortMetrics;
  treatment: CohortMetrics;
  aiCostsTotalCents: number;
}

export interface LiftCalculationResult {
  holdoutAvgRevenueCents: number | null;
  treatmentAvgRevenueCents: number | null;
  grossLiftPercent: number | null;
  holdoutProjectedCents: number | null;
  netLiftCents: number | null;
  roiPercent: number | null;
}

/**
 * Core lift formula implementation.
 *
 * gross_lift_percent = (treatment_avg - holdout_avg) / holdout_avg * 100
 * holdout_projected = holdout_avg × treatment_sessions (NOT subtraction)
 * net_lift_cents = (treatment_total - holdout_projected) - ai_costs
 * roi_percent = net_lift_cents / ai_costs * 100
 *
 * Edge cases:
 * - holdout_sessions = 0 → null (NOT Infinity/NaN)
 * - treatment worse → negative (NOT clamped to 0)
 * - ai_costs = 0 → roi = null (NOT Infinity)
 */
@Injectable()
export class RevenueLiftCalculatorService {
  calculate(input: LiftCalculationInput): LiftCalculationResult {
    const { holdout, treatment, aiCostsTotalCents } = input;

    // L5: Division guard — no holdout sessions means no valid metric
    if (holdout.sessions === 0 || holdout.orders === 0) {
      return {
        holdoutAvgRevenueCents: null,
        treatmentAvgRevenueCents: null,
        grossLiftPercent: null,
        holdoutProjectedCents: null,
        netLiftCents: null,
        roiPercent: null,
      };
    }

    // Average revenue PER SESSION (not per order)
    const holdoutAvg = holdout.totalRevenueCents / holdout.sessions;
    const treatmentAvg = treatment.totalRevenueCents / treatment.sessions;

    // L1: gross lift formula
    const grossLiftPercent = ((treatmentAvg - holdoutAvg) / holdoutAvg) * 100;

    // L2: holdout_projected = holdout_avg × treatment_sessions (NOT subtraction)
    const holdoutProjectedCents = holdoutAvg * treatment.sessions;

    // L3: net lift with cost subtraction
    const netLiftCents = (treatment.totalRevenueCents - holdoutProjectedCents) - aiCostsTotalCents;

    // L4: ROI — division by zero guard
    const roiPercent = aiCostsTotalCents === 0
      ? null
      : (netLiftCents / aiCostsTotalCents) * 100;

    return {
      holdoutAvgRevenueCents: holdoutAvg,
      treatmentAvgRevenueCents: treatmentAvg,
      grossLiftPercent,     // L6: may be negative (not clamped)
      holdoutProjectedCents,
      netLiftCents,         // L6: may be negative
      roiPercent,
    };
  }
}
