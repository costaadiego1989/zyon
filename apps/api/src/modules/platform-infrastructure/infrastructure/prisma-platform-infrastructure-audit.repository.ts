import type { PrismaClient } from "@prisma/client";
import type {
  PlatformInfrastructureIncident,
  PlatformInfrastructureIncidentObservation,
  PlatformInfrastructureIncidentSeverity,
  PlatformInfrastructureIncidentSource,
} from "../domain/platform-infrastructure-incidents.js";
import type {
  PlatformInfrastructureAuditRepository,
  PlatformInfrastructureReadAudit,
} from "../domain/ports/platform-infrastructure-audit-repository.port.js";

const READINESS_ACTION = "platform.infrastructure.readiness.read";
const READINESS_TARGET_TYPE = "platform_infrastructure_readiness";

export class PrismaPlatformInfrastructureAuditRepository implements PlatformInfrastructureAuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listRecentIncidentObservations(limit: number): Promise<PlatformInfrastructureIncidentObservation[]> {
    const rows = await this.prisma.platformAuditEvent.findMany({
      where: {
        action: READINESS_ACTION,
        targetType: READINESS_TARGET_TYPE,
      },
      select: {
        createdAt: true,
        details: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: normalizeLimit(limit),
    });

    return rows.flatMap((row) => incidentsFromDetails(row.details).map((incident) => ({
      incident,
      observedAt: row.createdAt,
    })));
  }

  async recordRead(input: PlatformInfrastructureReadAudit): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: READINESS_ACTION,
        permission: "platform:infrastructure:read",
        environment: input.environment,
        targetType: READINESS_TARGET_TYPE,
        correlationId: input.correlationId,
        outcome: "succeeded",
        details: {
          source: "direct_readiness_probe",
          incident_count: input.incidents.length,
          incident_observations: input.incidents,
        },
      },
    });
  }
}

function incidentsFromDetails(value: unknown): PlatformInfrastructureIncident[] {
  if (!isRecord(value) || !Array.isArray(value.incident_observations)) return [];

  return value.incident_observations.flatMap((candidate) => {
    const incident = toIncident(candidate);
    return incident ? [incident] : [];
  });
}

function toIncident(value: unknown): PlatformInfrastructureIncident | undefined {
  if (!isRecord(value)) return undefined;

  const { id, severity, source, title, description } = value;
  if (
    !isSafeIdentifier(id)
    || !isSeverity(severity)
    || !isSource(source)
    || !isSafeText(title)
    || !isSafeText(description)
  ) return undefined;

  return { id, severity, source, title, description };
}

function normalizeLimit(limit: number): number {
  return Math.max(1, Math.min(180, Math.trunc(limit)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9:._-]{1,160}$/i.test(value);
}

function isSafeText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\u0000-\u001F\u007F]/.test(value);
}

function isSeverity(value: unknown): value is PlatformInfrastructureIncidentSeverity {
  return value === "critical" || value === "warning";
}

function isSource(value: unknown): value is PlatformInfrastructureIncidentSource {
  return value === "readiness" || value === "queue" || value === "integration";
}
