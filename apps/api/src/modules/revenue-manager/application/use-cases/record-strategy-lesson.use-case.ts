import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { SignificanceCalculator } from "../../../experiments/domain/services/significance-calculator.service.js";
import { STRATEGY_LESSON_REPOSITORY_PORT, type StrategyLessonRepositoryPort } from "../../domain/ports/strategy-lesson-repository.port.js";
import { HYPOTHESIS_REPOSITORY_PORT, type HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import { StrategyLessonEntity } from "../../domain/entities/strategy-lesson.entity.js";
import type { PrismaClient } from "@prisma/client";

export interface RecordStrategyLessonInput {
  merchant_id: string;
  experiment_id: string;
  hypothesis_id: string;
}

export interface RecordStrategyLessonOutput {
  lesson_id: string;
  hypothesis_was_correct: boolean;
  conversion_lift_percent: number;
}

@Injectable()
export class RecordStrategyLessonUseCase {
  private readonly logger = new Logger(RecordStrategyLessonUseCase.name);
  private readonly significanceCalc = new SignificanceCalculator();

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(STRATEGY_LESSON_REPOSITORY_PORT) private readonly lessonRepo: StrategyLessonRepositoryPort,
    @Inject(HYPOTHESIS_REPOSITORY_PORT) private readonly hypothesisRepo: HypothesisRepositoryPort,
  ) {}

  async execute(input: RecordStrategyLessonInput): Promise<RecordStrategyLessonOutput> {
    // Fetch the completed experiment + results
    const experiment = await this.prisma.promptExperiment.findFirstOrThrow({
      where: { id: input.experiment_id, merchantId: input.merchant_id },
      include: { variants: { include: { results: true } } },
    });

    if (experiment.status !== "completed") {
      throw new Error("EXPERIMENT_NOT_COMPLETED");
    }

    // Fetch hypothesis to get original hypothesis_text and expected_lift
    const hypothesis = await this.hypothesisRepo.findById(input.hypothesis_id, input.merchant_id);
    if (!hypothesis) {
      throw new Error("HYPOTHESIS_NOT_FOUND");
    }
    if (hypothesis.snapshot().created_experiment_id !== input.experiment_id) {
      throw new Error("hypothesis_experiment_mismatch");
    }

    // Compute variant stats from results
    const variantStats = experiment.variants.map((v) => ({
      variantId: v.id,
      name: v.name,
      sessions: v.results.length,
      converted: v.results.filter((r) => r.converted).length,
    }));

    const sig = this.significanceCalc.calculateConfidence(variantStats);

    // Determine which variant is control vs challenger
    const controlVariant = experiment.variants.find((v) => v.isControl);
    const challengerVariant = experiment.variants.find((v) => !v.isControl);

    if (!controlVariant || !challengerVariant) {
      throw new Error("EXPERIMENT_MISSING_CONTROL_OR_CHALLENGER");
    }

    const controlStats = variantStats.find((s) => s.variantId === controlVariant.id);
    const challengerStats = variantStats.find((s) => s.variantId === challengerVariant.id);

    if (!controlStats || !challengerStats) {
      throw new Error("VARIANT_STATS_CALCULATION_FAILED");
    }

    const controlConversionRate = controlStats.sessions > 0 ? controlStats.converted / controlStats.sessions : 0;
    const challengerConversionRate = challengerStats.sessions > 0 ? challengerStats.converted / challengerStats.sessions : 0;

    const liftPercent = controlConversionRate > 0 ? ((challengerConversionRate - controlConversionRate) / controlConversionRate) * 100 : 0;

    // Hypothesis was correct if actual winner matches expected direction
    const hypothesisWasCorrect = liftPercent > 0; // If challenger beat control, hypothesis was correct

    // Create lesson entity
    const lesson = StrategyLessonEntity.create({
      merchant_id: input.merchant_id,
      experiment_id: input.experiment_id,
      hypothesis_id: input.hypothesis_id,
      hypothesis_text: hypothesis.hypothesis_text,
      actual_winner: sig.winnerId === controlVariant.id ? "control" : "challenger",
      hypothesis_was_correct: hypothesisWasCorrect,
      control_conversion_rate: controlConversionRate,
      challenger_conversion_rate: challengerConversionRate,
      conversion_lift_percent: liftPercent,
      sessions_per_variant: Math.min(controlStats.sessions, challengerStats.sessions),
      statistical_confidence: sig.confidence,
      insights: {
        why_winner_won: this.generateWinnerInsight(
          sig.winnerId === controlVariant.id ? controlVariant.name : challengerVariant.name,
          liftPercent,
        ),
        objection_reduction: "Quantify by comparing objection types in control vs challenger interactions (future: sentiment analysis)",
        decision_speed_impact: `${Math.round((challengerStats.sessions || 0) / 10)} sessions needed for significance`,
        cross_sell_impact: "Measure cross-sell acceptance rate difference between variants",
        recommended_next_steps: this.recommendNextSteps(hypothesisWasCorrect, liftPercent, sig.confidence),
      },
      generator_feedback: `Expected lift: ${hypothesis.expected_lift_percent}% | Actual lift: ${liftPercent.toFixed(2)}% | Confidence: ${(sig.confidence * 100).toFixed(1)}%`,
    });

    const saved = await this.lessonRepo.save(lesson) ?? lesson;
    this.logger.log(
      `Recorded strategy lesson for hypothesis ${input.hypothesis_id}: lift=${liftPercent.toFixed(2)}%, correct=${hypothesisWasCorrect}`,
    );

    return {
      lesson_id: saved.id,
      hypothesis_was_correct: saved.hypothesis_was_correct,
      conversion_lift_percent: saved.conversion_lift_percent,
    };
  }

  private generateWinnerInsight(winnerName: string, liftPercent: number): string {
    if (liftPercent > 20) {
      return `${winnerName} won significantly (${liftPercent.toFixed(1)}% lift). Strong signal to promote.`;
    } else if (liftPercent > 5) {
      return `${winnerName} showed modest improvement (${liftPercent.toFixed(1)}% lift). Consider repeating at scale.`;
    } else if (liftPercent > 0) {
      return `${winnerName} marginally better (${liftPercent.toFixed(1)}% lift). Continue testing other variables.`;
    }
    return `Results inconclusive. Recommend increasing sample size or testing different hypotheses.`;
  }

  private recommendNextSteps(correct: boolean, lift: number, confidence: number): string[] {
    const steps: string[] = [];
    if (correct && lift > 10) steps.push("Promote winning variant to 100% traffic");
    if (correct && lift <= 10) steps.push("Run variant at 50% traffic to confirm in production");
    if (!correct) steps.push("Analyze why hypothesis failed; refine targeting or messaging");
    if (confidence < 0.90) steps.push("Increase sample size before concluding");
    steps.push("Document learnings in strategy lesson database for LLM retraining");
    return steps;
  }
}
