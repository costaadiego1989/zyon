import { dashboardJson } from "../http/client.js";
import type { StrategyReview, StrategyReviewCommand, StrategyReviewReceipt } from "./strategy-review.js";
import type { IncentivePolicy, IncentivePolicyCommand } from "./incentive-policy.js";
import type { IncentiveReview, IncentiveDecision, IncentiveReviewCommand, IncentiveReviewReceipt } from "./incentive-review.js";

const PREFIX = "/revenue-manager";

export interface AnalysisStatus {
  mode: "weekly" | "legacy";
  enabled: boolean;
  generation_enabled?: boolean;
  queue_available: boolean;
  next_eligible_at: string | null;
  last_successful_at: string | null;
  overdue: boolean;
  run: null | { id: string; status: string; result: string | null; reason: string | null;
    createdAt: string; startedAt: string | null; completedAt: string | null; hypothesisId: string | null };
}

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
  discount_simulation?: {
    definition: "discount-catalog-replay-v1";
    sampleSize: number;
    observedConversionRate: number;
    minimumProjectedMarginPercent: number;
    replayDiscountTotalCents: number;
    paymentFeeAssumptionPercent: number;
  };
  [key: string]: unknown;
}

export interface Hypothesis {
  strategy_review?: { version: number; status: string; title: string; expires_at: string; expected_lift_percent: number };
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
  conversion_rate: number | null;
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
  funnel: { conversion_rate?: number | null; sessions_count?: number; total_sessions?: number } & Record<string, unknown>;
  abandonment: Record<string, unknown>;
  objections: { top_objection?: string; top?: string } & Record<string, unknown>;
  cross_sell: Record<string, unknown>;
  current_experiment?: Record<string, unknown>;
  cohorts: Record<string, unknown>;
  revenue: Record<string, unknown>;
  ai_costs_cents: number;
  data_quality?: { mature_sessions?: number };
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
    conversion_rate: raw.funnel?.conversion_rate == null ? null : raw.funnel.conversion_rate * 100,
    top_objection: typeof raw.abandonment?.top_abandonment_objection === "string" ? raw.abandonment.top_abandonment_objection : raw.objections?.top_objection ?? raw.objections?.top ?? "-",
    sessions_count: raw.data_quality?.mature_sessions ?? raw.funnel?.sessions_count ?? raw.funnel?.total_sessions ?? 0,
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
    getIncentiveMetrics(id: string, version: number): Promise<import("./incentive-metrics.js").IncentiveMetrics> {
      return dashboardJson(base, `${PREFIX}/strategies/${encodeURIComponent(id)}/incentive/metrics?version=${version}`, { method: "GET", cache: "no-store" }, f);
    },
    requestIncentiveAlternative(id: string, input: import("./incentive-review.js").IncentiveAlternativeCommand): Promise<import("./incentive-review.js").IncentiveAlternativeReceipt> {
      return dashboardJson(base, `${PREFIX}/strategies/${encodeURIComponent(id)}/incentive/alternatives`, {
        method: "POST", headers: { "Idempotency-Key": input.request_key }, jsonBody: {
          version: input.version, proposal_hash: input.proposal_hash, recommendation_hash: input.recommendation_hash,
          request_key: input.request_key, ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
        },
      }, f);
    },
    getIncentiveReview(id: string): Promise<IncentiveReview> {
      return dashboardJson(base, `${PREFIX}/strategies/${encodeURIComponent(id)}/incentive`, { method: "GET", cache: "no-store" }, f);
    },
    decideIncentive(id: string, kind: IncentiveDecision, input: IncentiveReviewCommand): Promise<IncentiveReviewReceipt> {
      return dashboardJson(base, `${PREFIX}/strategies/${encodeURIComponent(id)}/incentive/${kind}`, {
        method: "POST", headers: { "Idempotency-Key": input.request_key }, jsonBody: {
          version: input.version, proposal_hash: input.proposal_hash, recommendation_hash: input.recommendation_hash, request_key: input.request_key,
        },
      }, f);
    },
    getIncentivePolicy(): Promise<IncentivePolicy> {
      return dashboardJson(base, `${PREFIX}/incentive-policy`, { method: "GET", cache: "no-store" }, f);
    },
    saveIncentivePolicy(command: IncentivePolicyCommand): Promise<IncentivePolicy> {
      return dashboardJson(base, `${PREFIX}/incentive-policy`, { method: "PUT", jsonBody: command,
        headers: { "Idempotency-Key": command.requestKey } }, f);
    },
    getStrategyMetrics(id: string, version: number): Promise<import("./strategy-metrics.js").StrategyMetrics> {
      return dashboardJson(base, `${PREFIX}/strategies/${encodeURIComponent(id)}/metrics?version=${version}`, { method: "GET" }, f);
    },
    collectStrategyMetrics(id: string, version: number): Promise<import("./strategy-metrics.js").StrategyMetrics> {
      return dashboardJson(base, `${PREFIX}/strategies/${encodeURIComponent(id)}/metrics`, { method: "POST", jsonBody: { version } }, f);
    },
    getStrategyReview(id: string): Promise<StrategyReview> {
      return dashboardJson(base, `${PREFIX}/strategies/${encodeURIComponent(id)}`, { method: "GET" }, f);
    },
    decideStrategy(id: string, kind: "approve" | "reject" | "revision", input: StrategyReviewCommand): Promise<StrategyReviewReceipt> {
      return dashboardJson(base, `${PREFIX}/strategies/${encodeURIComponent(id)}/${kind === "revision" ? "revisions" : kind}`,
        { method: "POST", headers: { "Idempotency-Key": input.request_key }, jsonBody: {
          version: input.version, proposal_hash: input.proposal_hash, request_key: input.request_key,
          ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
        } }, f);
    },
    getAnalysisStatus(): Promise<AnalysisStatus> {
      return dashboardJson<AnalysisStatus>(base, `${PREFIX}/analysis-status`, { method: "GET" }, f);
    },
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

    async getHypothesis(id: string): Promise<Hypothesis> {
      return dashboardJson<Hypothesis>(base, `${PREFIX}/hypotheses/${encodeURIComponent(id)}`, { method: "GET" }, f);
    },

    async approveHypothesis(id: string, payload: { approved_by: string; mode: ApproveMode; approval_reason?: string }): Promise<void> {
      const result = await dashboardJson<{ status: string; experiment_id?: string; rule_id?: string }>(
        base,
        `${PREFIX}/hypotheses/${encodeURIComponent(id)}/approve`,
        { method: "POST", jsonBody: payload },
        f
      );
      if (result.status === "experiment_failed" || (payload.mode === "test_ab" ? !result.experiment_id : !result.rule_id)) {
        throw new Error("A estratégia foi aprovada, mas a aplicação não foi confirmada. Revise o estado antes de tentar novamente.");
      }
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
