import type {
  PlatformQueueProbeResult,
  PlatformPersistedIntegrationsSnapshot,
} from "./ports/platform-infrastructure-observability.port.js";

export type PlatformInfrastructureIncidentSeverity = "critical" | "warning";
export type PlatformInfrastructureIncidentSource = "readiness" | "queue" | "integration";
export type PlatformInfrastructureIncidentState = "present_in_current_read" | "not_present_in_current_read";

export type PlatformInfrastructureIncident = {
  id: string;
  severity: PlatformInfrastructureIncidentSeverity;
  source: PlatformInfrastructureIncidentSource;
  title: string;
  description: string;
};

export type PlatformInfrastructureIncidentObservation = {
  incident: PlatformInfrastructureIncident;
  observedAt: Date;
};

export type PlatformInfrastructureIncidentHistoryItem = PlatformInfrastructureIncident & {
  firstObservedAt: Date;
  lastObservedAt: Date;
  observations: number;
  state: PlatformInfrastructureIncidentState;
};

type InfrastructureReadinessSignal = {
  database: "connected" | "disconnected";
  redis: "connected" | "disconnected" | "not_configured";
};

export function detectPlatformInfrastructureIncidents(input: {
  readiness: InfrastructureReadinessSignal;
  queues: PlatformQueueProbeResult;
  integrations: PlatformPersistedIntegrationsSnapshot | undefined;
}): PlatformInfrastructureIncident[] {
  const incidents: PlatformInfrastructureIncident[] = [];

  addReadinessIncidents(incidents, input.readiness);
  addQueueIncidents(incidents, input.queues);
  addIntegrationIncidents(incidents, input.integrations);

  return incidents;
}

export function summarizePlatformInfrastructureIncidentHistory(
  observations: PlatformInfrastructureIncidentObservation[],
  current: PlatformInfrastructureIncident[],
  observedAt: Date,
  limit = 30,
): PlatformInfrastructureIncidentHistoryItem[] {
  const items = new Map<string, PlatformInfrastructureIncidentHistoryItem>();

  for (const observation of observations) {
    mergeObservation(items, observation.incident, observation.observedAt, false);
  }

  for (const incident of current) {
    mergeObservation(items, incident, observedAt, true);
  }

  return [...items.values()]
    .sort(compareIncidentHistory)
    .slice(0, limit);
}

function addReadinessIncidents(
  incidents: PlatformInfrastructureIncident[],
  readiness: InfrastructureReadinessSignal,
): void {
  if (readiness.database === "disconnected") {
    incidents.push({
      id: "readiness:database:disconnected",
      severity: "critical",
      source: "readiness",
      title: "Banco de dados indisponível",
      description: "A sonda local não conseguiu confirmar a conexão com o banco de dados.",
    });
  }

  if (readiness.redis === "disconnected") {
    incidents.push({
      id: "readiness:redis:disconnected",
      severity: "warning",
      source: "readiness",
      title: "Redis indisponível",
      description: "A sonda local não conseguiu confirmar a conexão com Redis.",
    });
  }
}

function addQueueIncidents(
  incidents: PlatformInfrastructureIncident[],
  queues: PlatformQueueProbeResult,
): void {
  if (queues.status === "unavailable") {
    incidents.push({
      id: "queue:bullmq:unavailable",
      severity: "critical",
      source: "queue",
      title: "Filas BullMQ indisponíveis",
      description: "Nenhuma fila observada pôde ser consultada nesta leitura local.",
    });
    return;
  }

  for (const queue of queues.queues) {
    if (queue.status === "unavailable") {
      incidents.push({
        id: `queue:${queue.key}:unavailable`,
        severity: "warning",
        source: "queue",
        title: `Fila ${queue.queue} indisponível`,
        description: "A leitura local não conseguiu consultar esta fila.",
      });
      continue;
    }

    if ((queue.counts?.failed ?? 0) > 0) {
      incidents.push({
        id: `queue:${queue.key}:failed_jobs`,
        severity: "warning",
        source: "queue",
        title: `Falhas na fila ${queue.queue}`,
        description: `${queue.counts?.failed} trabalho(s) com falha foram encontrados na leitura atual.`,
      });
    }
  }
}

function addIntegrationIncidents(
  incidents: PlatformInfrastructureIncident[],
  integrations: PlatformPersistedIntegrationsSnapshot | undefined,
): void {
  if (!integrations) return;

  for (const connection of integrations.connection_states) {
    if (!isIncidentConnectionStatus(connection.status)) continue;

    incidents.push({
      id: `integration:${connection.surface}:${connection.provider}:${normalizeId(connection.status)}`,
      severity: "warning",
      source: "integration",
      title: `Integração ${connection.provider} em estado ${connection.status}`,
      description: `${connection.count} conexão(ões) possuem esse estado persistido. O painel não consulta o provedor externo.`,
    });
  }

  for (const job of integrations.erp_sync_jobs) {
    if (job.status.toLowerCase() !== "failed") continue;

    incidents.push({
      id: "integration:erp_sync:failed",
      severity: "warning",
      source: "integration",
      title: "Falhas em sincronizações ERP",
      description: `${job.count} trabalho(s) ERP estão com estado persistido de falha.`,
    });
  }
}

function mergeObservation(
  items: Map<string, PlatformInfrastructureIncidentHistoryItem>,
  incident: PlatformInfrastructureIncident,
  observedAt: Date,
  presentInCurrentRead: boolean,
): void {
  const existing = items.get(incident.id);
  if (!existing) {
    items.set(incident.id, {
      ...incident,
      firstObservedAt: observedAt,
      lastObservedAt: observedAt,
      observations: 1,
      state: presentInCurrentRead ? "present_in_current_read" : "not_present_in_current_read",
    });
    return;
  }

  existing.firstObservedAt = earlier(existing.firstObservedAt, observedAt);
  existing.lastObservedAt = later(existing.lastObservedAt, observedAt);
  existing.observations += 1;
  existing.state = presentInCurrentRead ? "present_in_current_read" : existing.state;
  existing.severity = mostSevere(existing.severity, incident.severity);
  existing.title = incident.title;
  existing.description = incident.description;
}

function compareIncidentHistory(
  left: PlatformInfrastructureIncidentHistoryItem,
  right: PlatformInfrastructureIncidentHistoryItem,
): number {
  return stateOrder(left.state) - stateOrder(right.state)
    || severityOrder(left.severity) - severityOrder(right.severity)
    || right.lastObservedAt.getTime() - left.lastObservedAt.getTime()
    || left.id.localeCompare(right.id);
}

function stateOrder(state: PlatformInfrastructureIncidentState): number {
  return state === "present_in_current_read" ? 0 : 1;
}

function severityOrder(severity: PlatformInfrastructureIncidentSeverity): number {
  return severity === "critical" ? 0 : 1;
}

function mostSevere(
  left: PlatformInfrastructureIncidentSeverity,
  right: PlatformInfrastructureIncidentSeverity,
): PlatformInfrastructureIncidentSeverity {
  return left === "critical" || right === "critical" ? "critical" : "warning";
}

function earlier(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function later(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function isIncidentConnectionStatus(status: string): boolean {
  return new Set(["error", "failed", "disconnected", "inactive", "revoked", "expired"]).has(status.toLowerCase());
}

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
