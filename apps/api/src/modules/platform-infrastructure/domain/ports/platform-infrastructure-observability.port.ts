export const PLATFORM_INFRASTRUCTURE_QUEUE_PROBE = Symbol("PLATFORM_INFRASTRUCTURE_QUEUE_PROBE");
export const PLATFORM_INFRASTRUCTURE_INTEGRATIONS_REPOSITORY = Symbol("PLATFORM_INFRASTRUCTURE_INTEGRATIONS_REPOSITORY");

export type PlatformQueueProbeStatus = "available" | "degraded" | "unavailable" | "not_configured";

export type PlatformQueueCounts = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  paused: number;
  prioritized: number;
};

export type PlatformQueueSnapshot = {
  key: string;
  queue: string;
  description: string;
  status: "available" | "unavailable";
  counts?: PlatformQueueCounts;
};

export type PlatformQueueProbeResult = {
  status: PlatformQueueProbeStatus;
  source: "bullmq";
  queues: PlatformQueueSnapshot[];
};

export interface PlatformInfrastructureQueueProbe {
  probe(): Promise<PlatformQueueProbeResult>;
}

export type PlatformIntegrationConnectionState = {
  surface: "commerce" | "payments" | "erp" | "crm";
  provider: string;
  status: string;
  count: number;
};

export type PlatformErpSyncJobState = {
  status: string;
  count: number;
};

export type PlatformPersistedIntegrationsSnapshot = {
  connection_states: PlatformIntegrationConnectionState[];
  erp_sync_jobs: PlatformErpSyncJobState[];
};

export interface PlatformInfrastructureIntegrationsRepository {
  snapshot(): Promise<PlatformPersistedIntegrationsSnapshot>;
}
