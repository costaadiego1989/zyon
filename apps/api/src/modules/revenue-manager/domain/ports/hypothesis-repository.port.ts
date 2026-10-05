import type { HypothesisEntity } from "../entities/hypothesis.entity.js";
import type { CheckoutChatBaseline } from "../../../checkout/domain/services/checkout-chat-baseline.js";
import type { StrategyMeasurementPlanning } from "../strategy-measurement.js";
import type { StrategyDiscountStudy } from "../strategy-discount-study.js";
import type { StrategyOrchestration } from "../strategy-orchestration.js";

export type HypothesisAnalysisContext = { runId: string; leaseToken: number; checkoutBaseline?: CheckoutChatBaseline;
  measurementPlanning?: StrategyMeasurementPlanning; discountStudy?: StrategyDiscountStudy; orchestration?: StrategyOrchestration };

export const HYPOTHESIS_REPOSITORY_PORT = Symbol("HYPOTHESIS_REPOSITORY_PORT");

export interface HypothesisRepositoryPort {
  save(hypothesis: HypothesisEntity, analysisContext?: HypothesisAnalysisContext): Promise<void>;
  findById(id: string, merchantId: string): Promise<HypothesisEntity | null>;
  findByMerchant(merchantId: string, options?: { status?: string; limit?: number }): Promise<HypothesisEntity[]>;
  findPendingByMerchant(merchantId: string): Promise<HypothesisEntity[]>;
  findByObservation(observationId: string): Promise<HypothesisEntity[]>;
}
