import assert from "node:assert/strict";
import test from "node:test";
import { GetPlatformInfrastructureReadinessUseCase } from "./get-platform-infrastructure-readiness.use-case.js";
import type {
  PlatformInfrastructureAuditRepository,
  PlatformInfrastructureReadAudit,
} from "../domain/ports/platform-infrastructure-audit-repository.port.js";
import type { PlatformInfrastructureIncidentObservation } from "../domain/platform-infrastructure-incidents.js";

test("presents direct readiness, queue counts, integrations, and local incident history before auditing the read", async () => {
  const calls: string[] = [];
  const repository = new InMemoryInfrastructureAuditRepository(calls);
  repository.observations = [{
    incident: {
      id: "queue:previous:failed_jobs",
      severity: "warning",
      source: "queue",
      title: "Falhas anteriores",
      description: "Uma falha foi vista anteriormente.",
    },
    observedAt: new Date("2026-09-15T09:00:00.000Z"),
  }];
  const health = {
    readiness: async () => {
      calls.push("readiness");
      return { ready: true as const, db: "connected" as const, redis: "not_configured" as const };
    },
  };
  const queues = {
    probe: async () => {
      calls.push("queues");
      return {
        status: "available" as const,
        source: "bullmq" as const,
        queues: [{
          key: "outbox",
          queue: "domain-event-outbox",
          description: "Outbox",
          status: "available" as const,
          counts: { waiting: 0, active: 0, delayed: 0, failed: 2, paused: 0, prioritized: 0 },
        }],
      };
    },
  };
  const integrations = {
    snapshot: async () => {
      calls.push("integrations");
      return { connection_states: [], erp_sync_jobs: [] };
    },
  };
  const useCase = new GetPlatformInfrastructureReadinessUseCase(repository, health as never, queues, integrations);

  const result = await useCase.execute({
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
  });

  assert.deepEqual(calls, ["readiness", "queues", "integrations", "incident_history", "audit"]);
  assert.match(result.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.coverage.incident_history.status, "available");
  assert.match(result.coverage.incident_history.description, /não é monitoramento contínuo/i);
  assert.deepEqual(result.current_alerts.map((item) => item.id), ["queue:outbox:failed_jobs"]);
  assert.deepEqual(result.incident_history, {
    status: "available",
    source: "platform_audit_snapshot",
    items: [
      {
        id: "queue:outbox:failed_jobs",
        severity: "warning",
        source: "queue",
        title: "Falhas na fila domain-event-outbox",
        description: "2 trabalho(s) com falha foram encontrados na leitura atual.",
        firstObservedAt: result.incident_history.items[0]?.firstObservedAt,
        lastObservedAt: result.incident_history.items[0]?.lastObservedAt,
        observations: 1,
        state: "present_in_current_read",
      },
      {
        id: "queue:previous:failed_jobs",
        severity: "warning",
        source: "queue",
        title: "Falhas anteriores",
        description: "Uma falha foi vista anteriormente.",
        firstObservedAt: new Date("2026-09-15T09:00:00.000Z"),
        lastObservedAt: new Date("2026-09-15T09:00:00.000Z"),
        observations: 1,
        state: "not_present_in_current_read",
      },
    ],
  });
  assert.deepEqual(repository.audit, {
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
    incidents: result.current_alerts,
  });
});

test("does not return readiness when its required audit cannot be recorded", async () => {
  const health = {
    readiness: async () => ({ ready: false as const, db: "disconnected" as const, redis: "disconnected" as const }),
  };
  const useCase = new GetPlatformInfrastructureReadinessUseCase(
    {
      listRecentIncidentObservations: async () => [],
      recordRead: async () => { throw new Error("platform_infrastructure_audit_unavailable"); },
    },
    health as never,
    { probe: async () => ({ status: "not_configured" as const, source: "bullmq" as const, queues: [] }) },
    { snapshot: async () => ({ connection_states: [], erp_sync_jobs: [] }) },
  );

  await assert.rejects(
    () => useCase.execute({ actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test" }),
    /platform_infrastructure_audit_unavailable/,
  );
});

test("does not query persisted state or history while the database is unavailable", async () => {
  let snapshots = 0;
  let histories = 0;
  const useCase = new GetPlatformInfrastructureReadinessUseCase(
    {
      listRecentIncidentObservations: async () => {
        histories += 1;
        return [];
      },
      recordRead: async () => undefined,
    },
    { readiness: async () => ({ ready: false as const, db: "disconnected" as const, redis: "connected" as const }) } as never,
    { probe: async () => ({ status: "available" as const, source: "bullmq" as const, queues: [] }) },
    {
      snapshot: async () => {
        snapshots += 1;
        return { connection_states: [], erp_sync_jobs: [] };
      },
    },
  );

  const result = await useCase.execute({ actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test" });

  assert.equal(snapshots, 0);
  assert.equal(histories, 0);
  assert.deepEqual(result.external_integrations, {
    status: "unavailable",
    source: "persisted_connection_state",
  });
  assert.deepEqual(result.incident_history, {
    status: "unavailable",
    source: "platform_audit_snapshot",
  });
  assert.deepEqual(result.current_alerts, [{
    id: "readiness:database:disconnected",
    severity: "critical",
    source: "readiness",
    title: "Banco de dados indisponível",
    description: "A sonda local não conseguiu confirmar a conexão com o banco de dados.",
  }]);
});

test("keeps the current report when historical snapshots cannot be read", async () => {
  const useCase = new GetPlatformInfrastructureReadinessUseCase(
    {
      listRecentIncidentObservations: async () => { throw new Error("history_unavailable"); },
      recordRead: async () => undefined,
    },
    { readiness: async () => ({ ready: true as const, db: "connected" as const, redis: "connected" as const }) } as never,
    { probe: async () => ({ status: "available" as const, source: "bullmq" as const, queues: [] }) },
    { snapshot: async () => ({ connection_states: [], erp_sync_jobs: [] }) },
  );

  const result = await useCase.execute({ actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test" });

  assert.deepEqual(result.incident_history, {
    status: "unavailable",
    source: "platform_audit_snapshot",
  });
  assert.equal(result.coverage.incident_history.status, "unavailable");
});

class InMemoryInfrastructureAuditRepository implements PlatformInfrastructureAuditRepository {
  audit?: PlatformInfrastructureReadAudit;
  observations: PlatformInfrastructureIncidentObservation[] = [];

  constructor(private readonly calls: string[]) {}

  async listRecentIncidentObservations(): Promise<PlatformInfrastructureIncidentObservation[]> {
    this.calls.push("incident_history");
    return this.observations;
  }

  async recordRead(input: PlatformInfrastructureReadAudit): Promise<void> {
    this.calls.push("audit");
    this.audit = input;
  }
}
