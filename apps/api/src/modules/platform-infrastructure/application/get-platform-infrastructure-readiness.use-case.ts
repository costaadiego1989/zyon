import { Inject, Injectable } from "@nestjs/common";
import { HealthService, type ReadinessResult } from "../../../shared/health/health.service.js";
import {
  detectPlatformInfrastructureIncidents,
  summarizePlatformInfrastructureIncidentHistory,
  type PlatformInfrastructureIncident,
} from "../domain/platform-infrastructure-incidents.js";
import {
  PLATFORM_INFRASTRUCTURE_AUDIT_REPOSITORY,
  type PlatformInfrastructureAuditRepository,
  type PlatformInfrastructureReadAudit,
} from "../domain/ports/platform-infrastructure-audit-repository.port.js";
import {
  PLATFORM_INFRASTRUCTURE_INTEGRATIONS_REPOSITORY,
  PLATFORM_INFRASTRUCTURE_QUEUE_PROBE,
  type PlatformInfrastructureIntegrationsRepository,
  type PlatformInfrastructureQueueProbe,
} from "../domain/ports/platform-infrastructure-observability.port.js";

@Injectable()
export class GetPlatformInfrastructureReadinessUseCase {
  constructor(
    @Inject(PLATFORM_INFRASTRUCTURE_AUDIT_REPOSITORY)
    private readonly audit: PlatformInfrastructureAuditRepository,
    private readonly health: HealthService,
    @Inject(PLATFORM_INFRASTRUCTURE_QUEUE_PROBE)
    private readonly queues: PlatformInfrastructureQueueProbe,
    @Inject(PLATFORM_INFRASTRUCTURE_INTEGRATIONS_REPOSITORY)
    private readonly integrations: PlatformInfrastructureIntegrationsRepository,
  ) {}

  async execute(input: Omit<PlatformInfrastructureReadAudit, "incidents">) {
    const readiness = await this.health.readiness();
    const queues = await this.queues.probe();
    const integrations = readiness.db === "connected"
      ? await this.readPersistedIntegrations()
      : { status: "unavailable" as const, source: "persisted_connection_state" as const };
    const generatedAt = new Date();
    const currentAlerts = detectPlatformInfrastructureIncidents({
      readiness: {
        database: readiness.db,
        redis: readiness.redis,
      },
      queues,
      integrations: integrations.status === "available"
        ? {
          connection_states: integrations.connection_states,
          erp_sync_jobs: integrations.erp_sync_jobs,
        }
        : undefined,
    });
    const incidentHistory = readiness.db === "connected"
      ? await this.readIncidentHistory(currentAlerts, generatedAt)
      : unavailableIncidentHistory();

    await this.audit.recordRead({ ...input, incidents: currentAlerts });
    return presentReadiness(generatedAt, readiness, queues, integrations, currentAlerts, incidentHistory);
  }

  private async readPersistedIntegrations() {
    try {
      return {
        status: "available" as const,
        source: "persisted_connection_state" as const,
        ...(await this.integrations.snapshot()),
      };
    } catch {
      return { status: "unavailable" as const, source: "persisted_connection_state" as const };
    }
  }

  private async readIncidentHistory(currentAlerts: PlatformInfrastructureIncident[], generatedAt: Date) {
    try {
      const observations = await this.audit.listRecentIncidentObservations(180);
      return {
        status: "available" as const,
        source: "platform_audit_snapshot" as const,
        items: summarizePlatformInfrastructureIncidentHistory(observations, currentAlerts, generatedAt),
      };
    } catch {
      return unavailableIncidentHistory();
    }
  }
}

function unavailableIncidentHistory() {
  return {
    status: "unavailable" as const,
    source: "platform_audit_snapshot" as const,
  };
}

function presentReadiness(
  generatedAt: Date,
  readiness: ReadinessResult,
  queues: Awaited<ReturnType<PlatformInfrastructureQueueProbe["probe"]>>,
  integrations: Awaited<ReturnType<GetPlatformInfrastructureReadinessUseCase["readPersistedIntegrations"]>>,
  currentAlerts: PlatformInfrastructureIncident[],
  incidentHistory: Awaited<ReturnType<GetPlatformInfrastructureReadinessUseCase["readIncidentHistory"]>>,
) {
  return {
    generated_at: generatedAt.toISOString(),
    coverage: {
      readiness: {
        status: "available" as const,
        description: "Sonda direta atual de banco de dados e Redis.",
      },
      queues: {
        status: "available" as const,
        description: "Sonda BullMQ atual de oito filas operacionais registradas; ela não comprova a execução dos workers.",
      },
      external_integrations: {
        status: "available" as const,
        description: "Estado persistido de conexões e trabalhos ERP; sem chamadas aos provedores externos.",
      },
      incident_history: {
        status: incidentHistory.status,
        description: incidentHistory.status === "available"
          ? "Observações locais de alertas persistidas a cada leitura do painel; não é monitoramento contínuo nem confirmação de provedores externos."
          : "O banco não estava disponível para consultar as observações locais de alertas.",
      },
    },
    readiness: {
      status: readiness.ready ? "ready" as const : "unavailable" as const,
      database: readiness.db,
      redis: readiness.redis,
    },
    queues,
    external_integrations: integrations,
    current_alerts: currentAlerts,
    incident_history: incidentHistory,
  };
}
