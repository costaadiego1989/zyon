export interface StrategyMetricArm {
  assigned: number; mature: number; converted: number; orders: number; revenueCents: number;
}
export interface StrategyDeliveryArm {
  assigned: number; mature: number; pending: number;
  sessionsWithTurn: number; sessionsWithPublication: number; sessionsWithDisplay: number;
  admittedTurns: number; publishedTurns: number; displayedTurns: number;
  failedProviderTurns: number; unresolvedProviderTurns: number; suppressedTurns: number;
  pendingConvertedSessions: number; pendingRevenueCents: number;
}
export interface StrategyCostArm {
  orders: number; capturedOrders: number; coveredOrders: number;
  configuredProductCostCents: number | null; knownConfiguredProductCostCents: number | null;
}
export interface StrategyAiUsageArm {
  admittedTurns: number; pricedTurns: number; notDispatchedTurns: number; unknownTurns: number;
  currencies: string[]; currency: string | null; estimatedCostMicros: number | null;
  knownEstimatedCostMicros: number | null; heldUpperBoundMicros: number | null; overrunTurns: number;
}
export interface StrategyPaymentCostArm {
  orders: number; linkedOrders: number; coveredOrders: number;
  confirmedPlatformFeeCents: number | null; confirmedProviderFeeCents: number | null;
  confirmedPaymentFeesCents: number | null; knownConfirmedPaymentFeesCents: number | null;
}
export interface StrategyMetrics {
  strategyId: string; version: number;
  execution: null | { id: string; proposalHash: string; status: string; startedAt: string; endsAt: string; stoppedAt: string | null };
  measurement: null | { collectedAt: string; evidenceHash: string; result: {
    definitionVersion: string; state: string; reasons: string[]; asOf: string; matureAt: string | null;
    control: StrategyMetricArm; treatment: StrategyMetricArm; minimumSessionsPerArm: number;
    interval: null | { effectBps: number; lowerBps: number; upperBps: number };
    contributionCents: number | null; aiCostCents: number | null; promotionAllowed: boolean;
    economics?: { definition: string; source: string; control: StrategyCostArm; treatment: StrategyCostArm };
    aiUsage?: { definition: string; scope: string; tariffBasis: string; control: StrategyAiUsageArm; treatment: StrategyAiUsageArm };
    paymentCosts?: { definition: string; currency: string; scope: string; source: string;
      control: StrategyPaymentCostArm; treatment: StrategyPaymentCostArm };
    participation?: { definition: string; populationSource: string;
      control: { assigned: number; stoppedSessions: number; contextExitSessions: number };
      treatment: { assigned: number; stoppedSessions: number; contextExitSessions: number } };
    delivery?: { definition: string; populationSource: string; displayBasis: string;
      control: StrategyDeliveryArm; treatment: StrategyDeliveryArm };
  } };
}
