import { Inject, Injectable, Logger } from "@nestjs/common";
import { HYPOTHESIS_REPOSITORY_PORT, type HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import { OBSERVATION_REPOSITORY_PORT, type ObservationRepositoryPort } from "../../domain/ports/observation-repository.port.js";
import { STRATEGY_LESSON_REPOSITORY_PORT, type StrategyLessonRepositoryPort } from "../../domain/ports/strategy-lesson-repository.port.js";
import { HYPOTHESIS_GENERATOR_PORT, type HypothesisGeneratorPort } from "../../domain/ports/hypothesis-generator.port.js";
import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";
import { assessRiskLevel } from "../../domain/value-objects/hypothesis-risk-level.js";

export interface GenerateHypothesisInput {
  merchant_id: string;
  observation_id: string;
}

export interface GenerateHypothesisOutput {
  hypothesis_id: string;
  hypothesis_text: string;
  risk_level: "low" | "medium" | "high";
  approval_strategy: "auto" | "manual";
}

/**
 * GenerateHypothesisUseCase — Calls LLM to generate hypothesis from observation.
 *
 * Uses HYPOTHESIS_GENERATOR_PORT (LLM-backed implementation).
 * Assesses risk level, determines approval strategy (auto vs manual).
 * Saves hypothesis entity.
 */
@Injectable()
export class GenerateHypothesisUseCase {
  private readonly logger = new Logger(GenerateHypothesisUseCase.name);

  constructor(
    @Inject(OBSERVATION_REPOSITORY_PORT) private readonly observationRepo: ObservationRepositoryPort,
    @Inject(HYPOTHESIS_REPOSITORY_PORT) private readonly hypothesisRepo: HypothesisRepositoryPort,
    @Inject(STRATEGY_LESSON_REPOSITORY_PORT) private readonly lessonRepo: StrategyLessonRepositoryPort,
    @Inject(HYPOTHESIS_GENERATOR_PORT) private readonly generator: HypothesisGeneratorPort,
  ) {}

  async execute(input: GenerateHypothesisInput): Promise<GenerateHypothesisOutput> {
    // Fetch observation
    const observation = await this.observationRepo.findById(input.observation_id, input.merchant_id);
    if (!observation) {
      throw new Error(`OBSERVATION_NOT_FOUND: ${input.observation_id}`);
    }

    // Fetch past lessons for context
    const pastLessons = await this.lessonRepo.findByMerchant(input.merchant_id, 20);

    // Constraints (hardcoded for now; could be merchant-specific)
    const constraints = {
      max_discount_percent: 30,
      allow_free_shipping: true,
      max_running_experiments: 1,
    };

    // Call LLM to generate hypothesis
    const generationResponse = await this.generator.generate({
      merchant_id: input.merchant_id,
      observation: observation.snapshot(),
      past_lessons: pastLessons.map((l) => l.snapshot()),
      constraints,
    });

    // Assess risk level
    const riskLevel = assessRiskLevel(generationResponse.expected_lift_percent);

    // Determine approval strategy
    const approvalStrategy = riskLevel === "low" ? "auto" : "manual";

    // Create hypothesis entity
    const hypothesis = HypothesisEntity.create({
      merchant_id: input.merchant_id,
      observation_id: input.observation_id,
      hypothesis_text: generationResponse.hypothesis_text,
      reasoning: generationResponse.reasoning,
      expected_lift_percent: generationResponse.expected_lift_percent,
      risk_level: riskLevel,
      template: generationResponse.template,
      approval_strategy: approvalStrategy,
    });

    // Save
    await this.hypothesisRepo.save(hypothesis);

    this.logger.log(
      `Generated hypothesis for merchant ${input.merchant_id}: ` +
      `risk=${riskLevel}, strategy=${approvalStrategy}, expected_lift=${generationResponse.expected_lift_percent}%`,
    );

    return {
      hypothesis_id: hypothesis.id,
      hypothesis_text: hypothesis.hypothesis_text,
      risk_level: riskLevel,
      approval_strategy: approvalStrategy,
    };
  }
}
