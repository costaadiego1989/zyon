import type { ObservationSnapshot } from "../entities/observation.entity.js";
import type { StrategyLessonSnapshot } from "../entities/strategy-lesson.entity.js";

export const HYPOTHESIS_GENERATOR_PORT = Symbol("HYPOTHESIS_GENERATOR_PORT");

export interface HypothesisGenerationRequest {
  merchant_id: string;
  observation: ObservationSnapshot;
  past_lessons: StrategyLessonSnapshot[];
  constraints: {
    max_discount_percent: number;
    allow_free_shipping: boolean;
    max_running_experiments: number;
  };
}

export interface HypothesisGenerationResponse {
  hypothesis_text: string;
  reasoning: string;
  expected_lift_percent: number;
  template: {
    name: string;
    description: string;
    variant_a: { name: string; system_prompt: string; weight: number; is_control: boolean };
    variant_b: { name: string; system_prompt: string; weight: number; is_control: boolean };
  };
}

export interface HypothesisGeneratorPort {
  generate(request: HypothesisGenerationRequest): Promise<HypothesisGenerationResponse>;
}
