import { Prisma, type PrismaClient } from "@prisma/client";
import { StrategyLessonEntity, type StrategyLessonSnapshot } from "../domain/entities/strategy-lesson.entity.js";
import type { StrategyLessonRepositoryPort } from "../domain/ports/strategy-lesson-repository.port.js";

export class PrismaStrategyLessonRepository implements StrategyLessonRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(lesson: StrategyLessonEntity): Promise<StrategyLessonEntity> {
    const snap = lesson.snapshot();
    return this.prisma.$transaction(async (tx) => {
      const hypotheses = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM revenue_manager_hypotheses
        WHERE id = ${snap.hypothesis_id} AND merchant_id = ${snap.merchant_id}
          AND created_experiment_id = ${snap.experiment_id}
        FOR UPDATE
      `);
      if (hypotheses.length !== 1) throw new Error("hypothesis_experiment_mismatch");
      const existing = await tx.revenueManagerStrategyLesson.findFirst({
        where: { merchantId: snap.merchant_id, hypothesisId: snap.hypothesis_id, experimentId: snap.experiment_id },
      });
      if (existing) return StrategyLessonEntity.rehydrate(this.toDomain(existing));
      await tx.revenueManagerStrategyLesson.create({
      data: {
        id: snap.id,
        merchantId: snap.merchant_id,
        experimentId: snap.experiment_id,
        hypothesisId: snap.hypothesis_id,
        hypothesisText: snap.hypothesis_text,
        actualWinner: snap.actual_winner,
        hypothesisWasCorrect: snap.hypothesis_was_correct,
        controlConversionRate: snap.control_conversion_rate,
        challengerConversionRate: snap.challenger_conversion_rate,
        conversionLiftPercent: snap.conversion_lift_percent,
        sessionsPerVariant: snap.sessions_per_variant,
        statisticalConfidence: snap.statistical_confidence,
        insightsJson: snap.insights,
        generatorFeedback: snap.generator_feedback,
      },
      });
      return lesson;
    });
  }

  async findByMerchant(merchantId: string, limit = 10): Promise<StrategyLessonEntity[]> {
    const recs = await this.prisma.revenueManagerStrategyLesson.findMany({
      where: { merchantId },
      orderBy: { recordedAt: "desc" },
      take: limit,
    });
    return recs.map((r) => StrategyLessonEntity.rehydrate(this.toDomain(r)));
  }

  async findByExperiment(experimentId: string): Promise<StrategyLessonEntity[]> {
    const recs = await this.prisma.revenueManagerStrategyLesson.findMany({
      where: { experimentId },
      orderBy: { recordedAt: "desc" },
    });
    return recs.map((r) => StrategyLessonEntity.rehydrate(this.toDomain(r)));
  }

  async findByHypothesis(hypothesisId: string): Promise<StrategyLessonEntity | null> {
    const rec = await this.prisma.revenueManagerStrategyLesson.findFirst({
      where: { hypothesisId },
    });
    return rec ? StrategyLessonEntity.rehydrate(this.toDomain(rec)) : null;
  }

  private toDomain(rec: {
    id: string;
    merchantId: string;
    experimentId: string;
    hypothesisId: string;
    hypothesisText: string;
    actualWinner: string;
    hypothesisWasCorrect: boolean;
    controlConversionRate: unknown;
    challengerConversionRate: unknown;
    conversionLiftPercent: unknown;
    sessionsPerVariant: number;
    statisticalConfidence: unknown;
    insightsJson: unknown;
    generatorFeedback: string;
    recordedAt: Date;
  }): StrategyLessonSnapshot {
    return {
      id: rec.id,
      merchant_id: rec.merchantId,
      experiment_id: rec.experimentId,
      hypothesis_id: rec.hypothesisId,
      hypothesis_text: rec.hypothesisText,
      actual_winner: rec.actualWinner,
      hypothesis_was_correct: rec.hypothesisWasCorrect,
      control_conversion_rate: Number(rec.controlConversionRate),
      challenger_conversion_rate: Number(rec.challengerConversionRate),
      conversion_lift_percent: Number(rec.conversionLiftPercent),
      sessions_per_variant: rec.sessionsPerVariant,
      statistical_confidence: Number(rec.statisticalConfidence),
      insights: rec.insightsJson as StrategyLessonSnapshot["insights"],
      generator_feedback: rec.generatorFeedback,
      recorded_at: rec.recordedAt.toISOString(),
    };
  }
}
