import type { StrategyLessonEntity } from "../entities/strategy-lesson.entity.js";

export const STRATEGY_LESSON_REPOSITORY_PORT = Symbol("STRATEGY_LESSON_REPOSITORY_PORT");

export interface StrategyLessonRepositoryPort {
  save(lesson: StrategyLessonEntity): Promise<StrategyLessonEntity | void>;
  findByMerchant(merchantId: string, limit?: number): Promise<StrategyLessonEntity[]>;
  findByExperiment(experimentId: string): Promise<StrategyLessonEntity[]>;
  findByHypothesis(hypothesisId: string): Promise<StrategyLessonEntity | null>;
}
