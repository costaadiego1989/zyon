import { dashboardJson } from "../http/client.js";

const PREFIX = "/dashboard/analytics/revenue-lift";

export interface RevenueLiftSummary {
  lift_percent: number;
  confidence: "significant" | "insufficient_sample";
  ai_cost_brl: number;
  net_lift_brl: number;
  roi_percent: number;
  feature_breakout: Array<{ feature: string; contribution_percent: number }>;
}

export interface RevenueLiftCohort {
  cohort: string;
  sessions: number;
  revenue_brl: number;
  conversion_rate: number;
}

export interface RevenueLiftTrend {
  date: string;
  lift_percent: number;
  revenue_control_brl: number;
  revenue_treatment_brl: number;
}

export function revenueLiftEndpoints(base: string, f: typeof fetch) {
  return {
    async getRevenueLift(): Promise<RevenueLiftSummary> {
      return dashboardJson<RevenueLiftSummary>(base, PREFIX, { method: "GET" }, f);
    },

    async getRevenueLiftCohorts(): Promise<RevenueLiftCohort[]> {
      const res = await dashboardJson<{ data: RevenueLiftCohort[] } | RevenueLiftCohort[]>(
        base, `${PREFIX}/cohorts`, { method: "GET" }, f
      );
      return Array.isArray(res) ? res : res.data;
    },

    async getRevenueLiftTrend(): Promise<RevenueLiftTrend[]> {
      const res = await dashboardJson<{ data: RevenueLiftTrend[] } | RevenueLiftTrend[]>(
        base, `${PREFIX}/trend`, { method: "GET" }, f
      );
      return Array.isArray(res) ? res : res.data;
    },
  };
}
