export const PLATFORM_METRICS_REPOSITORY = Symbol("PLATFORM_METRICS_REPOSITORY");

export type PlatformMetricsGranularity = "day" | "month";

export type PlatformMetricsPeriod = {
  from: Date;
  to: Date;
  granularity: PlatformMetricsGranularity;
};

export type PlatformMetricsFinancialSeriesPoint = {
  bucket: string;
  confirmedPaymentCount: bigint;
  confirmedKnownAmountCents: bigint;
  incompleteAmountCount: bigint;
};

export type PlatformMetricsAiCost = {
  status: "estimated" | "provider_reported" | "reconciled";
  currency: string;
  costMicros: bigint;
  eventCount: bigint;
};

export type PlatformMetricsAiTotals = {
  eventCount: bigint;
  totalTokens: bigint;
  unpricedEventCount: bigint;
  costs: PlatformMetricsAiCost[];
};

export type PlatformMetricsAiSeriesPoint = {
  bucket: string;
  chatEventCount: bigint;
  voiceEventCount: bigint;
  chatTotalTokens: bigint;
  voiceTotalTokens: bigint;
  costs: Array<PlatformMetricsAiCost & { channel: "chat" | "voice" }>;
};

export type PlatformMetricsSnapshot = {
  financial: {
    observedReceivableCount: number;
    observedSince?: Date;
    confirmedPaymentCount: bigint;
    confirmedKnownAmountCents: bigint;
    incompleteAmountCount: bigint;
    series: PlatformMetricsFinancialSeriesPoint[];
  };
  subscriptions: {
    activeContractCount: number;
    activeContractWithKnownAmountCount: number;
    activeContractMissingAmountCount: number;
    contractedMrrKnownCents: bigint;
  };
  ai: {
    chat: PlatformMetricsAiTotals;
    voice: PlatformMetricsAiTotals;
    series: PlatformMetricsAiSeriesPoint[];
  };
};

export type PlatformMetricsReadAudit = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
  period: PlatformMetricsPeriod;
};

export interface PlatformMetricsRepository {
  snapshot(period: PlatformMetricsPeriod): Promise<PlatformMetricsSnapshot>;
  recordRead(input: PlatformMetricsReadAudit): Promise<void>;
}
