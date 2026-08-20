import { dashboardJson } from "../http/client.js";

const PREFIX = "/dashboard/revenue-manager";

export interface Hypothesis {
  id: string;
  hypothesis_text: string;
  expected_lift_percent: number;
  risk_level: "low" | "medium" | "high";
  status: "pending_review" | "approved" | "rejected";
  created_at: string;
}

export interface DailyObservation {
  date: string;
  conversion_rate: number;
  top_objection: string;
  sessions_count: number;
}

export interface StrategyLesson {
  experiment_id: string;
  actual_winner: string;
  lift_percent: number;
  lesson: string;
  learned_at: string;
}

export function revenueManagerEndpoints(base: string, f: typeof fetch) {
  return {
    async getHypotheses(): Promise<Hypothesis[]> {
      const res = await dashboardJson<{ data: Hypothesis[] } | Hypothesis[]>(
        base, `${PREFIX}/hypotheses`, { method: "GET" }, f
      );
      return Array.isArray(res) ? res : res.data;
    },

    async approveHypothesis(id: string): Promise<void> {
      await dashboardJson<unknown>(
        base,
        `${PREFIX}/hypotheses/${encodeURIComponent(id)}/approve`,
        { method: "POST" },
        f
      );
    },

    async rejectHypothesis(id: string): Promise<void> {
      await dashboardJson<unknown>(
        base,
        `${PREFIX}/hypotheses/${encodeURIComponent(id)}/reject`,
        { method: "POST" },
        f
      );
    },

    async getObservations(): Promise<DailyObservation[]> {
      const res = await dashboardJson<{ data: DailyObservation[] } | DailyObservation[]>(
        base, `${PREFIX}/observations`, { method: "GET" }, f
      );
      return Array.isArray(res) ? res : res.data;
    },

    async getStrategyLessons(): Promise<StrategyLesson[]> {
      const res = await dashboardJson<{ data: StrategyLesson[] } | StrategyLesson[]>(
        base, `${PREFIX}/strategy-lessons`, { method: "GET" }, f
      );
      return Array.isArray(res) ? res : res.data;
    },
  };
}
