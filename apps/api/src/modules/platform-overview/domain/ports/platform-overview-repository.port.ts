export type PlatformOverviewSnapshot = {
  generatedAt: Date;
  merchants: {
    registered: number;
    activeUsers: number;
  };
  subscriptions: {
    byStatus: Record<string, number>;
    activeRecords: number;
    activeTrials: number;
  };
  feedback: {
    received: number;
  };
  aiChat: {
    periodStartedAt: Date;
    usageEvents: number;
    totalTokens: number;
    pricedUsageEvents: number;
    unpricedUsageEvents: number;
    knownCostMicros: bigint;
  };
};

export type PlatformOverviewAuditInput = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
};

export interface PlatformOverviewRepository {
  snapshot(now: Date): Promise<PlatformOverviewSnapshot>;
  recordRead(input: PlatformOverviewAuditInput): Promise<void>;
}

export const PLATFORM_OVERVIEW_REPOSITORY = Symbol("PLATFORM_OVERVIEW_REPOSITORY");
