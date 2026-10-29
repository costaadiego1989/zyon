import { randomUUID } from "node:crypto";

export type StrategyLessonSnapshot = {
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
  insights: {
    why_winner_won: string;
    objection_reduction: string;
    decision_speed_impact: string;
    cross_sell_impact: string;
    recommended_next_steps: string[];
  };
  generator_feedback: string;
  recorded_at: string;
};

export class StrategyLessonEntity {
  private constructor(private _snapshot: StrategyLessonSnapshot) {}

  static create(input: {
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
    insights: StrategyLessonSnapshot["insights"];
    generator_feedback: string;
  }): StrategyLessonEntity {
    return new StrategyLessonEntity({
      id: randomUUID(),
      merchant_id: input.merchant_id,
      experiment_id: input.experiment_id,
      hypothesis_id: input.hypothesis_id,
      hypothesis_text: input.hypothesis_text,
      actual_winner: input.actual_winner,
      hypothesis_was_correct: input.hypothesis_was_correct,
      control_conversion_rate: input.control_conversion_rate,
      challenger_conversion_rate: input.challenger_conversion_rate,
      conversion_lift_percent: input.conversion_lift_percent,
      sessions_per_variant: input.sessions_per_variant,
      statistical_confidence: input.statistical_confidence,
      insights: input.insights,
      generator_feedback: input.generator_feedback,
      recorded_at: new Date().toISOString(),
    });
  }

  static rehydrate(snap: StrategyLessonSnapshot): StrategyLessonEntity {
    return new StrategyLessonEntity(snap);
  }

  get id(): string { return this._snapshot.id; }
  get merchant_id(): string { return this._snapshot.merchant_id; }
  get experiment_id(): string { return this._snapshot.experiment_id; }
  get hypothesis_id(): string { return this._snapshot.hypothesis_id; }
  get hypothesis_was_correct(): boolean { return this._snapshot.hypothesis_was_correct; }
  get conversion_lift_percent(): number { return this._snapshot.conversion_lift_percent; }
  get insights() { return this._snapshot.insights; }

  snapshot(): StrategyLessonSnapshot { return { ...this._snapshot }; }
}
