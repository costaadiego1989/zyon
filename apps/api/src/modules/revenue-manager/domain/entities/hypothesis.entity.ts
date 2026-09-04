import { randomUUID } from "node:crypto";
import type { AdvancedRule } from "@zyon/shared-types";

export type HypothesisType = "prompt" | "discount_rule";

export type HypothesisSnapshot = {
  id: string;
  merchant_id: string;
  observation_id: string;
  hypothesis_text: string;
  reasoning: string;
  expected_lift_percent: number;
  risk_level: "low" | "medium" | "high";
  /**
   * F2-T03: tipo da hipótese. Default "prompt" (backward-compat: snapshots
   * antigos sem o campo são reidratados como "prompt").
   */
  hypothesis_type?: HypothesisType;
  /**
   * F2-T03: regra de desconto candidata (JSON), presente apenas quando
   * hypothesis_type === "discount_rule". Persistida na coluna Json existente,
   * sem migration de coluna.
   */
  discount_rule_json?: AdvancedRule;
  template: {
    name: string;
    description: string;
    variant_a: { name: string; system_prompt: string; weight: number; is_control: boolean };
    variant_b: { name: string; system_prompt: string; weight: number; is_control: boolean };
  };
  status: "pending_review" | "approved" | "rejected" | "experiment_created" | "experiment_failed";
  approval_strategy: "auto" | "manual";
  merchant_approved_at?: string;
  merchant_approved_by?: string;
  merchant_approval_reason?: string;
  rejection_reason?: string;
  created_experiment_id?: string;
  experiment_creation_error?: string;
  created_at: string;
  updated_at: string;
};

export class HypothesisEntity {
  private constructor(private _snapshot: HypothesisSnapshot) {}

  static create(input: {
    merchant_id: string;
    observation_id: string;
    hypothesis_text: string;
    reasoning: string;
    expected_lift_percent: number;
    risk_level: "low" | "medium" | "high";
    template: HypothesisSnapshot["template"];
    approval_strategy: "auto" | "manual";
    hypothesis_type?: HypothesisType;
    discount_rule_json?: AdvancedRule;
  }): HypothesisEntity {
    const id = randomUUID();
    const now = new Date().toISOString();
    const isAutoApproved = input.approval_strategy === "auto";
    const hypothesisType: HypothesisType = input.hypothesis_type ?? "prompt";
    return new HypothesisEntity({
      id,
      merchant_id: input.merchant_id,
      observation_id: input.observation_id,
      hypothesis_text: input.hypothesis_text,
      reasoning: input.reasoning,
      expected_lift_percent: input.expected_lift_percent,
      risk_level: input.risk_level,
      hypothesis_type: hypothesisType,
      ...(input.discount_rule_json ? { discount_rule_json: input.discount_rule_json } : {}),
      template: input.template,
      status: isAutoApproved ? "approved" : "pending_review",
      approval_strategy: input.approval_strategy,
      ...(isAutoApproved ? { merchant_approved_by: "system", merchant_approved_at: now, merchant_approval_reason: "auto-approved (low risk)" } : {}),
      created_at: now,
      updated_at: now,
    });
  }

  static rehydrate(snap: HypothesisSnapshot): HypothesisEntity {
    // Backward-compat: snapshots persistidos antes de F2-T03 não têm o campo.
    return new HypothesisEntity({ ...snap, hypothesis_type: snap.hypothesis_type ?? "prompt" });
  }

  autoApprove(): HypothesisEntity {
    if (this._snapshot.status !== "pending_review") throw new Error("HYPOTHESIS_NOT_PENDING_REVIEW");
    return new HypothesisEntity({ ...this._snapshot, status: "approved", merchant_approved_at: new Date().toISOString(), merchant_approved_by: "system", merchant_approval_reason: "auto-approved (low risk)", updated_at: new Date().toISOString() });
  }

  approve(approvedBy: string, reason?: string): HypothesisEntity {
    if (this._snapshot.status !== "pending_review") throw new Error("HYPOTHESIS_NOT_PENDING_REVIEW");
    return new HypothesisEntity({ ...this._snapshot, status: "approved", merchant_approved_at: new Date().toISOString(), merchant_approved_by: approvedBy, merchant_approval_reason: reason, updated_at: new Date().toISOString() });
  }

  reject(reason: string): HypothesisEntity {
    if (this._snapshot.status !== "pending_review") throw new Error("HYPOTHESIS_NOT_PENDING_REVIEW");
    return new HypothesisEntity({ ...this._snapshot, status: "rejected", rejection_reason: reason, updated_at: new Date().toISOString() });
  }

  markExperimentCreated(experimentId: string): HypothesisEntity {
    if (this._snapshot.status !== "approved") throw new Error("HYPOTHESIS_NOT_APPROVED");
    return new HypothesisEntity({ ...this._snapshot, status: "experiment_created", created_experiment_id: experimentId, updated_at: new Date().toISOString() });
  }

  markExperimentFailed(error: string): HypothesisEntity {
    if (this._snapshot.status !== "approved") throw new Error("HYPOTHESIS_NOT_APPROVED");
    return new HypothesisEntity({ ...this._snapshot, status: "experiment_failed", experiment_creation_error: error, updated_at: new Date().toISOString() });
  }

  get id(): string { return this._snapshot.id; }
  get merchant_id(): string { return this._snapshot.merchant_id; }
  get observation_id(): string { return this._snapshot.observation_id; }
  get status() { return this._snapshot.status; }
  get risk_level() { return this._snapshot.risk_level; }
  get approval_strategy() { return this._snapshot.approval_strategy; }
  get template() { return this._snapshot.template; }
  get hypothesis_text() { return this._snapshot.hypothesis_text; }
  get expected_lift_percent() { return this._snapshot.expected_lift_percent; }
  get hypothesis_type(): HypothesisType { return this._snapshot.hypothesis_type ?? "prompt"; }
  get discount_rule_json(): AdvancedRule | undefined { return this._snapshot.discount_rule_json; }

  snapshot(): HypothesisSnapshot { return { ...this._snapshot }; }
}
