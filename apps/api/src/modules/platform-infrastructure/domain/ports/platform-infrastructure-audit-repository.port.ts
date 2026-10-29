import type {
  PlatformInfrastructureIncident,
  PlatformInfrastructureIncidentObservation,
} from "../platform-infrastructure-incidents.js";

export const PLATFORM_INFRASTRUCTURE_AUDIT_REPOSITORY = Symbol("PLATFORM_INFRASTRUCTURE_AUDIT_REPOSITORY");

export type PlatformInfrastructureReadAudit = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
  incidents: PlatformInfrastructureIncident[];
};

export interface PlatformInfrastructureAuditRepository {
  listRecentIncidentObservations(limit: number): Promise<PlatformInfrastructureIncidentObservation[]>;
  recordRead(input: PlatformInfrastructureReadAudit): Promise<void>;
}
