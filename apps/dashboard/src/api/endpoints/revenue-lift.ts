import { dashboardJson } from "../http/client.js";

const PREFIX = "/analytics/revenue-lift";

export interface RevenueLiftSummary {
  periodDays: number;
  holdout: { sessions: number; orders: number; revenueCents: number; avgRevenueCents: number | null };
  treatment: { sessions: number; orders: number; revenueCents: number; avgRevenueCents: number | null };
  lift: {
    grossLiftPercent: number | null;
    netLiftCents: number | null;
    roiPercent: number | null;
    holdoutProjectedCents: number | null;
    holdoutAvgRevenueCents: number | null;
    treatmentAvgRevenueCents: number | null;
  };
  aiCostCents: number;
  featureBreakout: Array<{ feature: string; orders: number; revenueCents: number }>;
}

export interface RevenueLiftTrendPoint {
  date: string;
  holdoutRevenueCents: number;
  treatmentRevenueCents: number;
  holdoutSessions: number;
  treatmentSessions: number;
  liftPercent: number | null;
}

export interface RevenueLiftTrendResponse {
  periodDays: number;
  trend: RevenueLiftTrendPoint[];
}

export function revenueLiftEndpoints(base: string, f: typeof fetch) {
  return {
    async getRevenueLift(periodDays?: number): Promise<RevenueLiftSummary> {
      const qs = periodDays ? `?periodDays=${periodDays}` : "";
      return dashboardJson<RevenueLiftSummary>(base, `${PREFIX}${qs}`, { method: "GET" }, f);
    },

    async getRevenueLiftTrend(days?: number): Promise<RevenueLiftTrendResponse> {
      const qs = days ? `?days=${days}` : "";
      return dashboardJson<RevenueLiftTrendResponse>(base, `${PREFIX}/trend${qs}`, { method: "GET" }, f);
    },
  };
}
