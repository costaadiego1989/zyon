import { dashboardJson } from "../http/client.js";

const PREFIX = "/revenue-manager";

/** Rule condition embedded in an AI candidate's discount_rule_json. */
export interface HypothesisRuleCondition {
  field: string;
  operator: string;
  value: string | number | boolean;
}

/** Rule action embedded in an AI candidate's discount_rule_json. */
export interface HypothesisRuleAction {
  type: string;
  params: Record<string, string | number>;
}

/** Advanced rule proposed by the AI (embedded inside template.discount_rule_json). */
export interface HypothesisDiscountRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: HypothesisRuleCondition[];
  action: HypothesisRuleAction;
}

/** Template payload; carries the embedded hypothesis_type + discount_rule_json. */
export interface HypothesisTemplate {
  hypothesis_type?: string;
  discount_rule_json?: HypothesisDiscountRule;
  [key: string]: unknown;
}

export interface Hypothesis {
  id: string;
  hypothesis_text: string;
  reasoning: string;
  expected_lift_percent: number;
  risk_level: "low" | "medium" | "high";
  status: "pending_review" | "approved" | "rejected" | "experiment_created" | "experiment_failed";
  template: HypothesisTemplate;
  created_at: string;
}

export type ApproveMode = "apply_direct" | "test_ab";

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

/** Shape returned by the API for observations (rich domain object). */
interface ObservationApiResponse {
  id: string;
  merchant_id: string;
  observation_window_start: string;
  observation_window_end: string;
  funnel: { conversion_rate?: number; sessions_count?: number; total_sessions?: number } & Record<string, unknown>;
  abandonment: Record<string, unknown>;
  objections: { top_objection?: string; top?: string } & Record<string, unknown>;
  cross_sell: Record<string, unknown>;
  current_experiment?: Record<string, unknown>;
  cohorts: Record<string, unknown>;
  revenue: Record<string, unknown>;
  ai_costs_cents: number;
  created_at: string;
}

/** Shape returned by the API for strategy lessons. */
interface StrategyLessonApiResponse {
  id: string;
  merchant_id: string;
  experiment_id: string;
  hypothesis_id: string;
  hypothesis_text: string;
  actual_winner: string;
  hypothesis_was_correct: boolean;
  control_conversion_rate: number;
  challenger_conversion_rate: number;
  conversion_lift_percent: number;
  sessions_per_variant: number;
  statistical_confidence: number;
  insights: Record<string, unknown>;
  generator_feedback: string;
  recorded_at: string;
}

/** Transform raw API observation to the flat shape the UI expects. */
function mapObservation(raw: ObservationApiResponse): DailyObservation {
  return {
    date: raw.observation_window_start ?? raw.created_at,
    conversion_rate: raw.funnel?.conversion_rate ?? 0,
    top_objection: raw.objections?.top_objection ?? raw.objections?.top ?? "-",
    sessions_count: raw.funnel?.sessions_count ?? raw.funnel?.total_sessions ?? 0,
  };
}

/** Transform raw API strategy lesson to the flat shape the UI expects. */
function mapLesson(raw: StrategyLessonApiResponse): StrategyLesson {
  return {
    experiment_id: raw.experiment_id,
    actual_winner: raw.actual_winner,
    lift_percent: raw.conversion_lift_percent,
    lesson: raw.hypothesis_text,
    learned_at: raw.recorded_at,
  };
}

export function revenueManagerEndpoints(base: string, f: typeof fetch) {
  return {
    async getHypotheses(options?: { status?: string; limit?: number }): Promise<Hypothesis[]> {
      const params = new URLSearchParams();
      if (options?.status) params.set("status", options.status);
      if (options?.limit != null) params.set("limit", String(options.limit));
      const qs = params.toString();
      const res = await dashboardJson<{ data: Hypothesis[] } | Hypothesis[]>(
        base, `${PREFIX}/hypotheses${qs ? `?${qs}` : ""}`, { method: "GET" }, f
      );
      return Array.isArray(res) ? res : res.data;
    },

    async approveHypothesis(id: string, payload: { approved_by: string; mode: ApproveMode; approval_reason?: string }): Promise<void> {
      await dashboardJson<unknown>(
        base,
        `${PREFIX}/hypotheses/${encodeURIComponent(id)}/approve`,
        { method: "POST", jsonBody: payload },
        f
      );
    },

    async rejectHypothesis(id: string, payload: { reason: string }): Promise<void> {
      await dashboardJson<unknown>(
        base,
        `${PREFIX}/hypotheses/${encodeURIComponent(id)}/reject`,
        { method: "POST", jsonBody: payload },
        f
      );
    },

    async getObservations(): Promise<DailyObservation[]> {
      const res = await dashboardJson<{ data: ObservationApiResponse[] } | ObservationApiResponse[]>(
        base, `${PREFIX}/observations`, { method: "GET" }, f
      );
      const raw = Array.isArray(res) ? res : res.data;
      return raw.map(mapObservation);
    },

    async getStrategyLessons(): Promise<StrategyLesson[]> {
      const res = await dashboardJson<{ data: StrategyLessonApiResponse[] } | StrategyLessonApiResponse[]>(
        base, `${PREFIX}/strategy-lessons`, { method: "GET" }, f
      );
      const raw = Array.isArray(res) ? res : res.data;
      return raw.map(mapLesson);
    },
  };
}
